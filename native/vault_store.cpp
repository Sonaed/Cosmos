#include "vault_store.h"
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonArray>
#include <QProcess>
#include <QtConcurrent/QtConcurrentRun>
#include <QSet>
#include <QTemporaryDir>
#include <QDirIterator>
#include <QSaveFile>
#include <QFile>
#include <QFileInfo>
#include <QDir>
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonArray>
#include <QDateTime>
#include <QCryptographicHash>
#include <QRegularExpression>
#include <QDesktopServices>
#include <QFileDialog>
#include <QUrl>
#include <QSettings>
#include <QCoreApplication>
#include <QMessageBox>
#include <QStandardPaths>

namespace {
QByteArray readFile(const QString &path) { QFile f(path); return f.open(QIODevice::ReadOnly) ? f.readAll() : QByteArray(); }
bool writeAtomic(const QString &path, const QByteArray &bytes) {
    if (QFileInfo::exists(path) && readFile(path) == bytes) return true;
    QSaveFile f(path);
    return f.open(QIODevice::WriteOnly) && f.write(bytes) == bytes.size() && f.commit();
}
QString key(const QString &id) { return QString::fromLatin1(QCryptographicHash::hash(id.toUtf8(), QCryptographicHash::Sha256).toHex().left(20)); }
QString slug(QString title) { title.replace(QRegularExpression("[^\\p{L}\\p{N}_-]+"),"-"); return title.left(70).isEmpty() ? "note" : title.left(70); }
QString quoted(const QString &s) { return QString::fromUtf8(QJsonDocument(QJsonArray{s}).toJson(QJsonDocument::Compact)).mid(1).chopped(1); }
}

VaultStore::VaultStore(QString root, QWidget *window) : QObject(window), m_root(std::move(root)), m_window(window) {
    m_timer.setSingleShot(true);m_timer.setInterval(500);
    connect(&m_timer, &QTimer::timeout, this, &VaultStore::startFlush);
}
QString VaultStore::loadWorkspace() const { return QString::fromUtf8(readFile(m_root+"/workspace.json")); }
QString VaultStore::readImportFile(const QString &url) const {
    const QString path=QFileInfo(QUrl(url).toLocalFile()).canonicalFilePath();
    bool ok=false;
    for(const QString &root:QStringList{m_root}+m_readableRoots){const QString allowed=QFileInfo(root+"/notion-import").canonicalFilePath();if(!allowed.isEmpty()&&path.startsWith(allowed+"/")){ok=true;break;}}
    if(!ok)return {};
    const QFileInfo info(path);const auto suffix=info.suffix().toLower();
    if(info.size()>25*1024*1024||!(suffix=="html"||suffix=="htm"||suffix=="md"||suffix=="markdown"))return {};
    return QString::fromUtf8(readFile(path));
}
void VaultStore::stageWorkspace(const QString &json) {
    // Cheap check on the UI thread; the full parse happens in the writer thread.
    const QStringView head=QStringView(json).left(64);
    if(json.isEmpty()||!head.trimmed().startsWith(u'{')||!json.contains(QStringLiteral("\"projects\""))) { emit failed("Le coffre reçu est invalide.");return; }
    m_pending=json;m_timer.start();
}
void VaultStore::startFlush() {
    if(m_writeFuture.isRunning()){m_timer.start();return;}
    if(!m_inFlight.isEmpty() && m_writeFuture.isFinished() && !m_writeFuture.result() && m_pending.isEmpty()) m_pending=m_inFlight;
    if(m_pending.isEmpty())return;
    m_inFlight=m_pending;m_pending.clear();
    const QString payload=m_inFlight;
    m_writeFuture=QtConcurrent::run([this,payload]{return writeWorkspace(payload);});
}
bool VaultStore::flush() {
    m_timer.stop();
    if(m_writeFuture.isRunning())m_writeFuture.waitForFinished();
    if(!m_inFlight.isEmpty() && m_writeFuture.isFinished() && !m_writeFuture.result() && m_pending.isEmpty())m_pending=m_inFlight;
    m_inFlight.clear();
    if(m_pending.isEmpty())return true;
    const auto payload=m_pending;
    if(!writeWorkspace(payload))return false;
    m_pending.clear();return true;
}
bool VaultStore::writeWorkspace(const QString &payload) {
    const auto json=payload.toUtf8();QJsonParseError parseError;const auto document=QJsonDocument::fromJson(json,&parseError);
    if(parseError.error!=QJsonParseError::NoError||!document.isObject()||!document.object().value("projects").isArray()){emit failed("Le coffre reçu est invalide.");return false;}
    if(!QDir().mkpath(m_root+"/backups")){emit failed("Impossible de créer le dossier de sauvegarde.");return false;}
    const auto old=readFile(m_root+"/workspace.json");const auto now=QDateTime::currentMSecsSinceEpoch();
    if(!old.isEmpty()&&old!=json&&now-m_lastBackup>=60000) {
        const auto path=m_root+"/backups/"+QString::number(now)+".json";
        if(!writeAtomic(path,old)){emit failed("Impossible de créer la sauvegarde précédente.");return false;}
        m_lastBackup=now;
        QDir backupDir(m_root+"/backups");const auto entries=backupDir.entryList({"*.json"},QDir::Files,QDir::Name);
        const int keep=json.size()>20*1024*1024?10:30;for(int i=0;i<entries.size()-keep;++i)backupDir.remove(entries.at(i));
    }
    if(!writeAtomic(m_root+"/workspace.json",json)){emit failed("Échec de l’enregistrement sur disque. Les modifications restent dans l’application.");return false;}
    bool mirrorOk=true;
    for(const auto &value:document.object().value("projects").toArray()) {
        const auto p=value.toObject();const auto dir=m_root+"/markdown/"+key(p.value("id").toString());
        if(!QDir().mkpath(dir)){mirrorOk=false;continue;}
        const auto previous=QJsonDocument::fromJson(readFile(dir+"/project.json")).object().value("files").toArray();
        QJsonArray files;
        QSet<QString> fileSet;
        QJsonArray allNotes=p.value("notes").toArray();
        for(const auto &galaxyValue:p.value("notes").toArray()) {
            const auto galaxy=galaxyValue.toObject();
            for(const auto &starValue:galaxy.value("starMap").toObject().value("notes").toArray()) {
                auto star=starValue.toObject();
                star.insert("galaxy",galaxy.value("title"));
                star.insert("id",galaxy.value("id").toString()+"--"+star.value("id").toString());
                allNotes.append(star);
            }
        }
        for(const auto &noteValue:allNotes) {
            const auto n=noteValue.toObject();const QString filename=slug(n.value("title").toString())+"--"+key(n.value("id").toString())+".md";
            files.append(filename);fileSet.insert(filename);
            const auto cacheKey=dir+"/"+filename;
            if(m_mirrorNotes.contains(cacheKey) && m_mirrorNotes.value(cacheKey)==n)continue;
            const QString markdown="---\ntitle: "+quoted(n.value("title").toString())+"\nproject: "+quoted(p.value("name").toString())+"\ngalaxy: "+quoted(n.value("galaxy").toString())+"\ncosmos_id: "+quoted(n.value("id").toString())+"\ntags: "+QString::fromUtf8(QJsonDocument(n.value("tags").toArray()).toJson(QJsonDocument::Compact))+"\n---\n\n"+n.value("body").toString()+"\n";
            const bool written=writeAtomic(dir+"/"+filename,markdown.toUtf8());
            if(written)m_mirrorNotes.insert(cacheKey,n);
            mirrorOk=written&&mirrorOk;
        }
        // Archive only files listed in our previous manifest, never arbitrary user files.
        for(const auto &name:previous){const QString file=name.toString();if(fileSet.contains(file)||QFileInfo(file).fileName()!=file)continue;
            m_mirrorNotes.remove(dir+"/"+file);
            QDir().mkpath(dir+"/.archive");const auto target=dir+"/.archive/"+QString::number(now)+"-"+file;
            if(QFileInfo::exists(dir+"/"+file))mirrorOk=QFile::rename(dir+"/"+file,target)&&mirrorOk;
        }
        QJsonObject meta{{"id",p.value("id")},{"name",p.value("name")},{"files",files}};
        if(mirrorOk)mirrorOk=writeAtomic(dir+"/project.json",QJsonDocument(meta).toJson())&&mirrorOk;
    }
    if(!mirrorOk){emit failed("Projets enregistrés ; certaines copies Markdown n’ont pas pu être mises à jour.");return false;}
    emit saved(m_root);return true;
}
void VaultStore::openFolder(){QDir().mkpath(m_root);QDesktopServices::openUrl(QUrl::fromLocalFile(m_root));}

QString VaultStore::integrationDescriptor() const {
    QJsonObject descriptor{
        {"protocol", "existence.v1"}, {"id", "cosmos"}, {"name", "Cosmos"},
        {"kind", "universe"}, {"state", "active"},
        {"capabilities", QJsonArray{"knowledge_graph", "notes", "projects", "star_maps", "markdown", "resource_export"}},
        {"resources", QJsonArray{QJsonObject{{"uri", "resource://existence/cosmos/workspace"}, {"type", "knowledge_workspace"}, {"lifecycle", "active"}}}},
        {"working_dir", QDir::currentPath()}, {"version", "0.3.0"}
    };
    return QString::fromUtf8(QJsonDocument(descriptor).toJson(QJsonDocument::Compact));
}

QString VaultStore::handleIntegrationMessage(const QString &message) {
    QJsonParseError error; const auto doc=QJsonDocument::fromJson(message.toUtf8(), &error);
    if(error.error!=QJsonParseError::NoError || !doc.isObject()) return QStringLiteral("{\"ok\":false,\"error\":\"invalid_message\"}");
    const auto object=doc.object(); const auto type=object.value("type").toString();
    if(type==QStringLiteral("ping")) return QStringLiteral("{\"ok\":true,\"from\":\"cosmos\",\"protocol\":\"existence.v1\"}");
    if(type==QStringLiteral("describe")) return integrationDescriptor();
    if(type==QStringLiteral("resource.query")) {
        QJsonObject result{{"ok",true},{"resources",QJsonArray{QJsonObject{{"uri","resource://existence/cosmos/workspace"},{"type","knowledge_workspace"},{"owner","cosmos"},{"lifecycle","active"}}}}};
        return QString::fromUtf8(QJsonDocument(result).toJson(QJsonDocument::Compact));
    }
    emit integrationMessage(message); return QStringLiteral("{\"ok\":true,\"accepted\":true}");
}
void VaultStore::importMarkdown(){
    const auto paths=QFileDialog::getOpenFileNames(m_window,"Importer des notes Markdown",QString(),"Markdown (*.md *.markdown);;Texte (*.txt)");
    if(paths.isEmpty())return;QJsonArray entries;
    for(const auto &path:paths){QFile f(path);if(!f.open(QIODevice::ReadOnly)){emit failed("Impossible de lire "+QFileInfo(path).fileName());return;}if(f.size()>20*1024*1024){emit failed("Ce fichier dépasse 20 Mo : "+QFileInfo(path).fileName());return;}
        entries.append(QJsonObject{{"title",QFileInfo(path).completeBaseName()},{"body",QString::fromUtf8(f.readAll())}});
    }
    emit markdownImported(QString::fromUtf8(QJsonDocument(entries).toJson(QJsonDocument::Compact)));
}

void VaultStore::importNotionZip(){
    const auto paths=QFileDialog::getOpenFileNames(m_window, QStringLiteral("Importer Notion — sélectionner HTML et/ou Markdown ZIP"), QString(), QStringLiteral("Export Notion (*.zip)"));
    if(paths.isEmpty())return;
    const QString target=m_root+"/notion-import/notion-"+QString::number(QDateTime::currentMSecsSinceEpoch());
    importNotionArchive(paths,0,target,{});
}
void VaultStore::importNotionArchive(const QStringList &paths,int index,const QString &target,QJsonArray pages){
    if(index>=paths.size()){
        if(pages.isEmpty()){QDir(target).removeRecursively();emit failed("Aucune page HTML, Markdown ou CSV trouvée.");return;}
        emit notionImported(QString::fromUtf8(QJsonDocument(QJsonObject{{"root",target},{"pages",pages}}).toJson(QJsonDocument::Compact)));return;
    }
    const QString directory=target+"/"+QString::number(index);
    if(!QDir().mkpath(directory)){emit failed("Impossible de préparer l’import Notion.");return;}
    auto *unzip=new QProcess(this);
    connect(unzip,&QProcess::errorOccurred,this,[this,unzip](QProcess::ProcessError error){if(error==QProcess::FailedToStart){emit failed("Le programme unzip est introuvable.");unzip->deleteLater();}});
    connect(unzip,QOverload<int,QProcess::ExitStatus>::of(&QProcess::finished),this,[this,unzip,paths,index,target,directory,pages](int code,QProcess::ExitStatus status) mutable {
        unzip->deleteLater();if(status!=QProcess::NormalExit||code>1){QDir(target).removeRecursively();emit failed("Impossible de décompresser cet export Notion.");return;}
        // Large Notion exports contain nested "Part-N.zip" archives: extract them too.
        extractNested(directory,0,[this,paths,index,target,directory,pages](bool ok) mutable {
        if(!ok){QDir(target).removeRecursively();emit failed("Impossible de décompresser une archive interne de l’export Notion.");return;}
        QDirIterator it(directory,{"*.html","*.htm","*.md","*.markdown","*.csv"},QDir::Files,QDirIterator::Subdirectories);
        while(it.hasNext()){
            const QString path=it.next();QFile file(path);if(!file.open(QIODevice::ReadOnly)||file.size()>25*1024*1024)continue;
            const QString suffix=QFileInfo(path).suffix().toLower();
            pages.append(QJsonObject{{"path",QDir(directory).relativeFilePath(path)},{"assetRoot",directory},{"html",QString::fromUtf8(file.readAll())},{"kind",suffix=="csv"?"csv":suffix=="md"||suffix=="markdown"?"markdown":"html"},{"title",QFileInfo(path).completeBaseName()}});
        }
        importNotionArchive(paths,index+1,target,pages);
        });
    });
    unzip->start("unzip",{"-q","-o",paths[index],"-d",directory});
}

void VaultStore::importNotionFiles(){
    const auto paths=QFileDialog::getOpenFileNames(m_window, QStringLiteral("Importer des fichiers Notion"), QString(), QStringLiteral("Notion (*.html *.htm *.csv *.md *.markdown);;Tous les fichiers (*)"));
    if(paths.isEmpty())return; QJsonArray entries;
    for(const auto &path:paths){QFile f(path);if(!f.open(QIODevice::ReadOnly)||f.size()>25*1024*1024)continue;const auto suffix=QFileInfo(path).suffix().toLower();entries.append(QJsonObject{{"path",QFileInfo(path).fileName()},{"assetRoot",QFileInfo(path).absolutePath()},{"title",QFileInfo(path).completeBaseName()},{"kind",suffix=="csv"?"csv":suffix=="md"||suffix=="markdown"?"markdown":"html"},{"html",QString::fromUtf8(f.readAll())}});}
    if(entries.isEmpty()){emit failed("Aucun fichier Notion lisible.");return;}emit notionImported(QString::fromUtf8(QJsonDocument(QJsonObject{{"root",m_root},{"pages",entries},{"multiFile",true}}).toJson(QJsonDocument::Compact)));
}

void VaultStore::extractNested(const QString &directory,int depth,std::function<void(bool)> done){
    QString nested;
    QDirIterator it(directory,{"*.zip","*.ZIP"},QDir::Files,QDirIterator::Subdirectories);
    if(it.hasNext())nested=it.next();
    if(nested.isEmpty()||depth>50){done(true);return;}
    auto *unzip=new QProcess(this);
    const QString into=QFileInfo(nested).absolutePath();
    connect(unzip,QOverload<int,QProcess::ExitStatus>::of(&QProcess::finished),this,[this,unzip,nested,directory,depth,done](int code,QProcess::ExitStatus status){
        unzip->deleteLater();QFile::remove(nested);
        if(status!=QProcess::NormalExit||code>1){done(false);return;}
        extractNested(directory,depth+1,done);
    });
    unzip->start("unzip",{"-q","-o",nested,"-d",into});
}
void VaultStore::discardImport(const QString &root){
    const QString base=QFileInfo(m_root+"/notion-import").canonicalFilePath(),path=QFileInfo(root).canonicalFilePath();
    if(!base.isEmpty()&&path.startsWith(base+"/notion-"))QDir(path).removeRecursively();
}
QString VaultStore::configuredRoot(const QString &fallback){
    const QString chosen=QSettings("Cosmos","Cosmos").value("vaultRoot").toString();
    if(!chosen.isEmpty()&&QDir().mkpath(chosen)&&QFileInfo(chosen).isWritable())return chosen;
    return fallback;
}
QString VaultStore::chooseFolder(){
    const QString dir=QFileDialog::getExistingDirectory(m_window,"Choisir le dossier du coffre Cosmos",QFileInfo(m_root).absolutePath());
    if(dir.isEmpty()||QDir(dir)==QDir(m_root))return {};
    if(!QFileInfo(dir).isWritable()){emit failed("Ce dossier n’est pas accessible en écriture.");return {};}
    flush();
    if(!QFileInfo::exists(dir+"/workspace.json")){
        // New empty folder: carry the current vault over. Existing vault: open it as is.
        const QByteArray current=readFile(m_root+"/workspace.json");
        if(!current.isEmpty()&&!writeAtomic(dir+"/workspace.json",current)){emit failed("Impossible de copier le coffre dans ce dossier.");return {};}
    }
    QSettings("Cosmos","Cosmos").setValue("vaultRoot",dir);
    return dir;
}
void VaultStore::resetFolder(){flush();QSettings("Cosmos","Cosmos").remove("vaultRoot");}
void VaultStore::restartApp(){
    flush();
    QStringList args=QCoreApplication::arguments().mid(1);args.removeAll("--restarted");args<<"--restarted";
    QProcess::startDetached(QCoreApplication::applicationFilePath(),args);
    QCoreApplication::quit();
}
void VaultStore::cleanTemporaryFiles(const QString &root){
    // Leftovers of the self-checks in /tmp and interrupted Notion imports.
    QDir tmp(QDir::tempPath());
    for(const QString &name:tmp.entryList({"cosmos-*.txt","cosmos-*.png","cosmos-*.json"},QDir::Files))tmp.remove(name);
    QDir imports(root+"/notion-import");
    for(const QFileInfo &info:imports.entryInfoList({"notion-*"},QDir::Dirs|QDir::NoDotAndDotDot)){
        QDirIterator any(info.absoluteFilePath(),QDir::Files,QDirIterator::Subdirectories);
        if(!any.hasNext())QDir(info.absoluteFilePath()).removeRecursively();
    }
    QDirIterator zips(root+"/notion-import",{"*.zip"},QDir::Files,QDirIterator::Subdirectories);
    while(zips.hasNext())QFile::remove(zips.next());
}
