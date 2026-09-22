#include <QAction>
#include <QApplication>
#include <QDir>
#include <QFileDialog>
#include <QFileInfo>
#include <QIcon>
#include <QMainWindow>
#include <QMenuBar>
#include <QMessageBox>
#include <QStandardPaths>
#include <QStatusBar>
#include <QWebEngineDownloadRequest>
#include <QWebEnginePage>
#include <QWebEngineProfile>
#include <QWebEngineSettings>
#include <QWebEngineView>
#include <QDesktopServices>
#include <QUrl>
#include <QTemporaryDir>
#include <QDebug>
#include <QFile>
#include <memory>
#include <QTimer>
#include <QWebChannel>
#include <QLockFile>
#include "vault_store.h"
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonArray>
#include <QDirIterator>

static QString resolveAssets() {
    const QString besideApp = QDir(QCoreApplication::applicationDirPath())
                                  .absoluteFilePath("../share/cosmos");
    if (QFileInfo::exists(QDir(besideApp).filePath("index.html")))
        return QDir::cleanPath(besideApp);
    return QStringLiteral(COSMOS_SOURCE_DIR);
}

int main(int argc, char *argv[]) {
    QCoreApplication::setAttribute(Qt::AA_ShareOpenGLContexts);
    QApplication app(argc, argv);
    QCoreApplication::setOrganizationName("Cosmos");
    QCoreApplication::setApplicationName("Cosmos");
    QCoreApplication::setApplicationVersion("0.2.0");
    app.setDesktopFileName("cosmos");

    const QString assets = resolveAssets();
    const bool smokeCheck = app.arguments().contains(QStringLiteral("--smoke-check"));
    QTemporaryDir checkProfile;
    const QString dataRoot = smokeCheck ? checkProfile.path() : QStandardPaths::writableLocation(QStandardPaths::AppDataLocation);
    QDir().mkpath(dataRoot + "/profile");
    QDir().mkpath(dataRoot + "/cache");
    QLockFile instanceLock(dataRoot + "/cosmos.lock");
    if (!instanceLock.tryLock(0)) {
        QMessageBox::information(nullptr, "Cosmos", "Cosmos est déjà ouvert. Reviens à sa fenêtre pour continuer.");
        return 0;
    }

    // Destroy the window and its page before the persistent profile.
    auto profileOwner = std::make_unique<QWebEngineProfile>(QStringLiteral("Cosmos"));
    auto *profile = profileOwner.get();
    profile->setPersistentStoragePath(dataRoot + "/profile");
    profile->setCachePath(dataRoot + "/cache");
    profile->setHttpCacheType(QWebEngineProfile::DiskHttpCache);
    profile->setHttpCacheMaximumSize(64 * 1024 * 1024);

    auto windowOwner = std::make_unique<QMainWindow>();
    auto *window = windowOwner.get();
    window->setWindowTitle(QStringLiteral("Cosmos — espace de pensée"));
    window->setMinimumSize(1080, 700);
    window->resize(1510, 960);
    const QString iconPath = QDir(assets).filePath("icon.svg");
    if (QFileInfo::exists(iconPath)) window->setWindowIcon(QIcon(iconPath));

    auto *view = new QWebEngineView(window);
    auto *page = new QWebEnginePage(profile, view);
    page->setBackgroundColor(QColor(QStringLiteral("#080c19")));
    page->settings()->setAttribute(QWebEngineSettings::LocalContentCanAccessFileUrls, true);
    view->setPage(page);
    view->setContextMenuPolicy(Qt::NoContextMenu);
    window->setCentralWidget(view);
    auto *vault = new VaultStore(dataRoot + "/vault", window);
    auto *channel = new QWebChannel(page);
    channel->registerObject(QStringLiteral("vault"), vault);
    page->setWebChannel(channel);
    QObject::connect(&app, &QCoreApplication::aboutToQuit, vault, &VaultStore::flush);

    const QString appStyle = QStringLiteral(
        "QMainWindow{background:#080c19;} QMenuBar{background:#0b1120;color:#e5edff;spacing:5px;padding:5px;}"
        "QMenuBar::item{padding:6px 9px;background:transparent;} QMenuBar::item:selected{background:#263452;border-radius:4px;}"
        "QMenu{background:#111b30;color:#e5edff;border:1px solid #354462;padding:5px;}"
        "QMenu::item{padding:7px 28px 7px 20px;} QMenu::item:selected{background:#263452;}"
        "QStatusBar{background:#0b1120;color:#94a4bf;border-top:1px solid #25324b;}"
    );
    app.setStyleSheet(appStyle);

    auto *fileMenu = window->menuBar()->addMenu(QStringLiteral("Fichier"));
    auto *newProject = fileMenu->addAction(QStringLiteral("Nouveau projet…"));
    newProject->setShortcut(QKeySequence(QStringLiteral("Ctrl+Shift+N")));
    QObject::connect(newProject, &QAction::triggered, view, [view] {
        view->page()->runJavaScript("openProjectDialog()");
    });
    auto *newNote = fileMenu->addAction(QStringLiteral("Nouvelle note"));
    newNote->setShortcut(QKeySequence(QStringLiteral("Ctrl+N")));
    QObject::connect(newNote, &QAction::triggered, view, [view] {
        view->page()->runJavaScript("document.getElementById('new-note-top').click()");
    });
    auto *today = fileMenu->addAction(QStringLiteral("Note du jour"));
    today->setShortcut(QKeySequence(QStringLiteral("Ctrl+J")));
    QObject::connect(today, &QAction::triggered, view, [view] {
        view->page()->runJavaScript("document.getElementById('day-note').click()");
    });
    fileMenu->addSeparator();
    auto *importMarkdown = fileMenu->addAction(QStringLiteral("Importer des notes Markdown…"));
    QObject::connect(importMarkdown, &QAction::triggered, vault, &VaultStore::importMarkdown);
    auto *openVault = fileMenu->addAction(QStringLiteral("Ouvrir les sauvegardes sur disque"));
    QObject::connect(openVault, &QAction::triggered, vault, &VaultStore::openFolder);
    auto *importVault = fileMenu->addAction(QStringLiteral("Restaurer une sauvegarde…"));
    importVault->setShortcut(QKeySequence(QStringLiteral("Ctrl+O")));
    QObject::connect(importVault, &QAction::triggered, view, [view] {
        view->page()->runJavaScript("document.getElementById('backup-import').click()");
    });
    auto *exportVault = fileMenu->addAction(QStringLiteral("Exporter le projet actif…"));
    exportVault->setShortcut(QKeySequence(QStringLiteral("Ctrl+Shift+S")));
    QObject::connect(exportVault, &QAction::triggered, view, [view] {
        view->page()->runJavaScript("document.getElementById('backup-export').click()");
    });
    auto *exportAll = fileMenu->addAction(QStringLiteral("Sauvegarder tous les projets…"));
    QObject::connect(exportAll, &QAction::triggered, view, [view] {
        view->page()->runJavaScript("exportWorkspace()");
    });
    fileMenu->addSeparator();
    auto *quit = fileMenu->addAction(QStringLiteral("Quitter Cosmos"));
    quit->setShortcut(QKeySequence::Quit);
    QObject::connect(quit, &QAction::triggered, &app, &QApplication::quit);

    auto *editMenu = window->menuBar()->addMenu(QStringLiteral("Édition"));
    auto *search = editMenu->addAction(QStringLiteral("Rechercher dans les notes…"));
    search->setShortcut(QKeySequence(QStringLiteral("Ctrl+K")));
    QObject::connect(search, &QAction::triggered, view, [view] {
        view->page()->runJavaScript("document.getElementById('search-open').click()");
    });
    auto *viewMenu = window->menuBar()->addMenu(QStringLiteral("Affichage"));
    auto *reload = viewMenu->addAction(QStringLiteral("Recharger Cosmos"));
    reload->setShortcut(QKeySequence::Refresh);
    QObject::connect(reload, &QAction::triggered, view, &QWebEngineView::reload);

    QObject::connect(profile, &QWebEngineProfile::downloadRequested, window,
                     [window](QWebEngineDownloadRequest *download) {
        const QString suggested = download->downloadFileName();
        const QString path = QFileDialog::getSaveFileName(
            window, QStringLiteral("Enregistrer depuis Cosmos"),
            QDir(QStandardPaths::writableLocation(QStandardPaths::DocumentsLocation))
                .filePath(suggested));
        if (path.isEmpty()) {
            download->cancel();
            return;
        }
        const QFileInfo target(path);
        download->setDownloadDirectory(target.absolutePath());
        download->setDownloadFileName(target.fileName());
        download->accept();
    });

    QObject::connect(view, &QWebEngineView::loadFinished, window, [window](bool ok) {
        window->statusBar()->showMessage(ok
            ? QStringLiteral("Données conservées sur cet appareil")
            : QStringLiteral("Impossible de charger Cosmos — vérifie les fichiers de l’application"),
            ok ? 4500 : 12000);
    });

    const QString entry = QDir(assets).filePath("index.html");
    if (smokeCheck) {
        auto reloaded=std::make_shared<bool>(false);
        QObject::connect(view, &QWebEngineView::loadFinished, &app, [page, view, vault, reloaded, &app](bool ok) {
            if (!ok) { app.exit(1); return; }
            if (*reloaded) {
                auto *readyTimer=new QTimer(&app);auto attempts=std::make_shared<int>(0);
                QObject::connect(readyTimer,&QTimer::timeout,&app,[page,view,vault,readyTimer,attempts,&app]{
                    if(++*attempts>100){readyTimer->stop();app.exit(1);return;}
                    page->runJavaScript("window.cosmosNativeReady===true",[page,view,vault,readyTimer,&app](const QVariant &ready){
                        if(!ready.toBool())return;readyTimer->stop();
                page->runJavaScript(QString::fromUtf8(R"JS(
                    (()=>{try{if(workspace.projects.length!==2||activeProject().name!=='Projet contrôle B'||notes.length!==2||notes[0].body!=='Beta'||links.length!==1)throw Error('Projet non restauré');const a=workspace.projects.find(p=>p.id!==activeProjectId);if(a.notes[0].body!=='Alpha'||a.camera.scale!==1.7)throw Error('Autre projet altéré');return 'PASS: restauration native après effacement du cache, projets isolés, corbeille, Markdown, caméras et graphe 3D';}catch(e){return 'FAIL: '+e.stack}})()
                )JS"), [view, vault, &app](const QVariant &result) {
                    QTimer::singleShot(650,&app,[view,vault,&app,result]{
                        QString message=result.toString();
                        if(!vault->flush())message="FAIL: native disk flush";
                        const auto stored=QJsonDocument::fromJson(vault->loadWorkspace().toUtf8()).object();
                        if(stored.value("projects").toArray().size()!=2)message="FAIL: native workspace not saved";
                        QDirIterator files(vault->rootPath()+"/markdown",{"*.md"},QDir::Files,QDirIterator::Subdirectories);int count=0;while(files.hasNext()){files.next();++count;}
                        if(count<3)message="FAIL: Markdown mirror missing";
                        if(message.startsWith("PASS:"))message+=" ; sauvegarde native et copies Markdown";
                        qInfo().noquote()<<message;QFile report("/tmp/cosmos-smoke-result.txt");if(report.open(QIODevice::WriteOnly))report.write(message.toUtf8());
                        view->grab().save("/tmp/cosmos-project-preview.png");app.exit(message.startsWith("PASS:")?0:1);
                    });
                });
                    });
                });readyTimer->start(100);
                return;
            }
            page->runJavaScript(QString::fromUtf8(R"JS(
                (() => { try {
                    const check=(v,m)=>{if(!v)throw Error(m)};
                    check(notes.length===0,'empty start');
                    draw();draw();
                    addNote();document.getElementById('editor-title').value='Note de contrôle';
                    document.getElementById('editor-body').value='Contenu personnel';saveEdit();
                    check(notes.length===1&&notes[0].body==='Contenu personnel','create/save');
                    document.getElementById('favorite').click();check(notes[0].favorite,'favorite');
                    document.getElementById('view2d').click();document.getElementById('zoom-in').click();
                    openSearch();searchRender('contrôle');check(document.querySelectorAll('.result').length===1,'search');
                    document.querySelector('.result').click();
                    addNote();document.getElementById('editor-title').value='Deuxième';saveEdit();
                    check(links.length===1,'connection');
                    links=[];editing=true;renderDetail();
                    const editor=document.getElementById('editor-body');
                    editor.value='# Projet\n**Important**\n- [ ] Avancer\n[[Note de contrôle]]\n<img src=x onerror=alert(1)>';
                    editor.dispatchEvent(new Event('input',{bubbles:true}));
                    check(JSON.parse(localStorage.getItem('cosmos-workspace-v2')).projects.find(p=>p.id===activeProjectId).notes[1].body===editor.value,'autosave');
                    check(links.length===1&&links[0][2]==='wiki','automatic wiki connection');
                    saveEdit();
                    select(notes[0].id);editing=true;renderDetail();document.getElementById('editor-title').value='Renommée';captureEditor();
                    check(notes[1].body.includes('[[Renommée]]'),'references follow rename');
                    check(renderBacklinks(notes[0]).includes('Deuxième'),'incoming references');
                    document.getElementById('editor-title').value='Note de contrôle';saveEdit();select(notes[1].id);
                    toggleWritingMode();check(document.querySelector('.app').classList.contains('writing-mode'),'writing mode');toggleWritingMode();saveEdit();
                    check(document.querySelector('.note-body h1').textContent==='Projet','markdown heading');
                    check(document.querySelector('.note-body strong').textContent==='Important','markdown strong');
                    check(!document.querySelector('.note-body img'),'markdown escaping');
                    document.querySelector('[data-task-line]').click();
                    check(notes[1].body.includes('- [x] Avancer'),'interactive task');
                    editing=true;renderDetail();document.getElementById('editor-body').value='Sans référence';
                    document.getElementById('editor-body').dispatchEvent(new Event('input',{bubbles:true}));
                    check(links.length===0,'removed wiki connection');saveEdit();
                    check(JSON.parse(localStorage.getItem('cosmos-workspace-v2')).projects.find(p=>p.id===activeProjectId).notes.length===2,'storage');
                    window.confirm=()=>true;document.getElementById('note-menu').click();
                    document.getElementById('note-menu').click();check(notes.length===0&&links.length===0,'delete');
                    draw();check(document.querySelector('.empty-state'),'empty state');
                    check(activeProject().trash.length===2,'trash retains deleted notes');
                    restoreNoteFromTrash(activeProject().trash[0].id);check(notes.length===1,'restore note');
                    document.getElementById('note-menu').click();check(notes.length===0,'delete restored note');
                    importMarkdownNotes([{title:'Fichier',body:'---\ntitle: "Import Markdown"\ntags: ["test"]\n---\n\nTexte importé'}]);
                    check(notes[0].title==='Import Markdown'&&notes[0].tags[0]==='test'&&notes[0].body==='Texte importé','markdown import');
                    document.getElementById('note-menu').click();
                    
                    const initialId=activeProjectId;
                    addNote();document.getElementById('editor-title').value='Même titre';document.getElementById('editor-body').value='Alpha';saveEdit();
                    const secondId=createProject('Projet contrôle B');
                    check(notes.length===0&&links.length===0,'new project empty');
                    addNote();document.getElementById('editor-title').value='Même titre';document.getElementById('editor-body').value='Beta';saveEdit();
                    switchProject(initialId);check(notes.length===1&&notes[0].body==='Alpha','project A isolation');
                    scale=1.7;rotY=.9;saveWorkspace();
                    switchProject(secondId);check(notes.length===1&&notes[0].body==='Beta'&&scale===1,'project B isolation and camera');
                    switchProject(initialId);check(scale===1.7&&rotY===.9,'restore project camera');
                    switchProject(secondId);addNote();document.getElementById('editor-title').value='Voisin B';saveEdit();
                    check(links.length===1,'project links');
                    select(notes[0].id);focusSelected();let center=project(notes[0]);check(Math.abs(center.x-dims().w/2)<.1,'camera focus');
                    notes.push({id:'unconnected',title:'Seule',body:'',group:'Idées',tags:[],x:.8,y:.6,z:.3});
                    neighborsOnly=true;check(!visible(notes[2])&&visible(notes[1]),'neighbors filter');neighborsOnly=false;notes.pop();
                    const backup=JSON.parse(JSON.stringify(workspace));
                    const imported=validateImportedProject(backup.projects[0]);check(imported.notes[0].body==='Alpha','backup round trip');
                    select(notes[1].id);drag={type:'node',id:notes[0].id,moved:false};window.dispatchEvent(new PointerEvent('pointerup'));check(selected===notes[0].id,'node selection');
                    is3d=true;organizeGraph();
                    const awaitLayout=()=>{try{if(layoutFrame){requestAnimationFrame(awaitLayout);return}check(notes.every(n=>Number.isFinite(n.x)&&Number.isFinite(n.y)&&Number.isFinite(n.z)),'finite layout');check(notes.some(n=>n.x!==lastLayout[n.id].x),'layout moved');document.getElementById('undo-layout').click();check(lastLayout===null,'undo layout');saveWorkspace();window.cosmosCheckResult='PASS: projets isolés, caméras, Markdown, sauvegarde, focus, voisinage, placement 3D et annulation';}catch(e){window.cosmosCheckResult='FAIL: '+e.stack}};
                    requestAnimationFrame(awaitLayout);return 'WAIT';

                } catch(e) {return 'FAIL: '+e.stack} })()
            )JS"), [page, vault, reloaded, &app](const QVariant &result) {
                auto finish=[page,vault,reloaded,&app](const QString &message){if(message.startsWith("PASS:")){if(!vault->flush()){app.exit(1);return;}*reloaded=true;page->runJavaScript("localStorage.removeItem('cosmos-workspace-v2');localStorage.removeItem('cosmos-notes');localStorage.removeItem('cosmos-links');",[page](const QVariant &){page->triggerAction(QWebEnginePage::Reload);});return;}qInfo().noquote()<<message;QFile report("/tmp/cosmos-smoke-result.txt");if(report.open(QIODevice::WriteOnly))report.write(message.toUtf8());app.exit(1);};
                if(result.toString()!="WAIT"){finish(result.toString());return;}
                auto *timer=new QTimer(&app);auto attempts=std::make_shared<int>(0);
                QObject::connect(timer,&QTimer::timeout,&app,[page,timer,attempts,finish]{
                    if(++*attempts>150){timer->stop();finish("FAIL: timeout du placement 3D");return;}
                    page->runJavaScript("window.cosmosCheckResult || ''",[timer,finish](const QVariant &value){if(!value.toString().isEmpty()){timer->stop();finish(value.toString());}});
                });timer->start(100);
            });
        });
    }
    if (!QFileInfo::exists(entry)) {
        QMessageBox::critical(nullptr, QStringLiteral("Cosmos"),
                              QStringLiteral("Fichier d’interface introuvable :\n%1").arg(entry));
        return 1;
    }
    view->load(QUrl::fromLocalFile(entry));
    window->show();
    return app.exec();
}
