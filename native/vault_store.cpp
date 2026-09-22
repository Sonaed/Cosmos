#include "vault_store.h"
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
    connect(&m_timer, &QTimer::timeout, this, &VaultStore::flush);
}
QString VaultStore::loadWorkspace() const { return QString::fromUtf8(readFile(m_root+"/workspace.json")); }
void VaultStore::stageWorkspace(const QString &json) {
    QJsonParseError error;
    const auto doc=QJsonDocument::fromJson(json.toUtf8(),&error);
    if(error.error!=QJsonParseError::NoError || !doc.isObject() || !doc.object().value("projects").isArray()) { emit failed("Le coffre reçu est invalide.");return; }
    m_pending=json;m_timer.start();
}
bool VaultStore::flush() {
    m_timer.stop();if(m_pending.isEmpty())return true;
    const auto json=m_pending.toUtf8();const auto document=QJsonDocument::fromJson(json);
    if(!QDir().mkpath(m_root+"/backups")){emit failed("Impossible de créer le dossier de sauvegarde.");return false;}
    const auto old=readFile(m_root+"/workspace.json");const auto now=QDateTime::currentMSecsSinceEpoch();
    if(!old.isEmpty()&&old!=json&&now-m_lastBackup>=60000) {
        const auto path=m_root+"/backups/"+QString::number(now)+".json";
        if(!writeAtomic(path,old)){emit failed("Impossible de créer la sauvegarde précédente.");return false;}
        m_lastBackup=now;
        QDir backupDir(m_root+"/backups");const auto entries=backupDir.entryList({"*.json"},QDir::Files,QDir::Name);
        for(int i=0;i<entries.size()-30;++i)backupDir.remove(entries.at(i));
    }
    if(!writeAtomic(m_root+"/workspace.json",json)){emit failed("Échec de l’enregistrement sur disque. Les modifications restent dans l’application.");return false;}
    bool mirrorOk=true;
    for(const auto &value:document.object().value("projects").toArray()) {
        const auto p=value.toObject();const auto dir=m_root+"/markdown/"+key(p.value("id").toString());
        if(!QDir().mkpath(dir)){mirrorOk=false;continue;}
        const auto previous=QJsonDocument::fromJson(readFile(dir+"/project.json")).object().value("files").toArray();
        QJsonArray files;
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
            files.append(filename);
            const QString markdown="---\ntitle: "+quoted(n.value("title").toString())+"\nproject: "+quoted(p.value("name").toString())+"\ngalaxy: "+quoted(n.value("galaxy").toString())+"\ncosmos_id: "+quoted(n.value("id").toString())+"\ntags: "+QString::fromUtf8(QJsonDocument(n.value("tags").toArray()).toJson(QJsonDocument::Compact))+"\n---\n\n"+n.value("body").toString()+"\n";
            mirrorOk=writeAtomic(dir+"/"+filename,markdown.toUtf8())&&mirrorOk;
        }
        // Archive only files listed in our previous manifest, never arbitrary user files.
        for(const auto &name:previous){const QString file=name.toString();if(files.contains(name)||QFileInfo(file).fileName()!=file)continue;
            QDir().mkpath(dir+"/.archive");const auto target=dir+"/.archive/"+QString::number(now)+"-"+file;
            if(QFileInfo::exists(dir+"/"+file))mirrorOk=QFile::rename(dir+"/"+file,target)&&mirrorOk;
        }
        QJsonObject meta{{"id",p.value("id")},{"name",p.value("name")},{"files",files}};
        if(mirrorOk)mirrorOk=writeAtomic(dir+"/project.json",QJsonDocument(meta).toJson())&&mirrorOk;
    }
    m_pending.clear();
    if(!mirrorOk){emit failed("Projets enregistrés ; certaines copies Markdown n’ont pas pu être mises à jour.");return false;}
    emit saved(m_root);return true;
}
void VaultStore::openFolder(){QDir().mkpath(m_root);QDesktopServices::openUrl(QUrl::fromLocalFile(m_root));}
void VaultStore::importMarkdown(){
    const auto paths=QFileDialog::getOpenFileNames(m_window,"Importer des notes Markdown",QString(),"Markdown (*.md *.markdown);;Texte (*.txt)");
    if(paths.isEmpty())return;QJsonArray entries;
    for(const auto &path:paths){QFile f(path);if(!f.open(QIODevice::ReadOnly)){emit failed("Impossible de lire "+QFileInfo(path).fileName());return;}if(f.size()>20*1024*1024){emit failed("Ce fichier dépasse 20 Mo : "+QFileInfo(path).fileName());return;}
        entries.append(QJsonObject{{"title",QFileInfo(path).completeBaseName()},{"body",QString::fromUtf8(f.readAll())}});
    }
    emit markdownImported(QString::fromUtf8(QJsonDocument(entries).toJson(QJsonDocument::Compact)));
}
