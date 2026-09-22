#pragma once
#include <QObject>
#include <QTimer>
#include <QString>
#include <QWidget>

class VaultStore final : public QObject {
    Q_OBJECT
public:
    explicit VaultStore(QString root, QWidget *window);
    Q_INVOKABLE QString loadWorkspace() const;
    Q_INVOKABLE void stageWorkspace(const QString &json);
    Q_INVOKABLE bool flush();
    Q_INVOKABLE void openFolder();
    Q_INVOKABLE void importMarkdown();
    QString rootPath() const { return m_root; }
signals:
    void saved(const QString &path);
    void failed(const QString &message);
    void markdownImported(const QString &json);
private:
    QString m_root;
    QString m_pending;
    QTimer m_timer;
    QWidget *m_window;
    qint64 m_lastBackup = 0;
};
