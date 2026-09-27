#pragma once
#include <QObject>
#include <QTimer>
#include <QString>
#include <QWidget>
#include <QHash>
#include <QJsonObject>
#include <QFuture>
#include <QJsonArray>
#include <functional>
#include <QStringList>

class VaultStore final : public QObject {
    Q_OBJECT
public:
    explicit VaultStore(QString root, QWidget *window);
    Q_INVOKABLE QString loadWorkspace() const;
    Q_INVOKABLE QString readImportFile(const QString &url) const;
    Q_INVOKABLE void stageWorkspace(const QString &json);
    Q_INVOKABLE bool flush();
    Q_INVOKABLE void openFolder();
    Q_INVOKABLE QString vaultPath() const { return m_root; }
    Q_INVOKABLE QString chooseFolder();
    Q_INVOKABLE void resetFolder();
    Q_INVOKABLE void restartApp();
    Q_INVOKABLE void discardImport(const QString &root);
    static QString configuredRoot(const QString &fallback);
    static void cleanTemporaryFiles(const QString &root);
    void addReadableRoot(const QString &root) { m_readableRoots << root; }
    Q_INVOKABLE void importMarkdown();
    Q_INVOKABLE void importNotionZip();
    Q_INVOKABLE void importNotionFiles();
    Q_INVOKABLE QString integrationDescriptor() const;
    Q_INVOKABLE QString handleIntegrationMessage(const QString &message);
    QString rootPath() const { return m_root; }
signals:
    void saved(const QString &path);
    void failed(const QString &message);
    void markdownImported(const QString &json);
    void notionImported(const QString &json);
    void integrationMessage(const QString &message);
private:
    void extractNested(const QString &directory,int depth,std::function<void(bool)> done);
    void importNotionArchive(const QStringList &paths,int index,const QString &target,QJsonArray pages);
    void startFlush();
    bool writeWorkspace(const QString &payload);
    QFuture<bool> m_writeFuture;
    QString m_inFlight;
    QHash<QString, QJsonObject> m_mirrorNotes;
    QString m_root;
    QStringList m_readableRoots;
    QString m_pending;
    QTimer m_timer;
    QWidget *m_window;
    qint64 m_lastBackup = 0;
};
