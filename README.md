Fait par IA : J'apprend Python et Pyside actuellement afin de ne plus dépendre d'outil comme GPT mais le besoin de refaire des outils pour mon workflow était important 
Mon objectif est de réaliser mes outil moi-même et de les adapté au besoin que je peux avoir et qui pourrait interessé un plus grand nombre de personne 

Cosmos fait partie d'un environement de travail appelé Existence qui sera released quand ready

# Cosmos — application de bureau

Cosmos est une application Linux de notes reliées avec fenêtre, menus et stockage local propres à l’application. L’interface graphique est embarquée dans Qt WebEngine ; aucun onglet de navigateur ni serveur web n’est nécessaire.

## Compiler et lancer

Pré-requis : C++17, CMake 3.21+ et Qt 6 avec Widgets et WebEngineWidgets.

```sh
./build-desktop.sh
./start-desktop.sh
```

Le binaire compilé est `build/cosmos-desktop`. Pour ouvrir Cosmos, lancer `./start-desktop.sh`.

## Installer dans le menu des applications

```sh
cmake --install build --prefix "$HOME/.local"
```

Cela installe le programme, son interface, son icône et son lanceur `.desktop` dans `~/.local`.

## Données

Les projets sont enregistrés automatiquement dans un fichier `vault/workspace.json` sous le dossier de données de Cosmos, avec une écriture atomique en C++. Le cache de l’interface est conservé en complément ; le fichier natif permet de récupérer les projets si ce cache disparaît. Une seule instance utilise le coffre à la fois.

Le menu **Fichier → Ouvrir les sauvegardes sur disque** ouvre ce dossier. Il contient des copies Markdown par projet, un manifeste décrivant leur nom et leurs fichiers, et jusqu’à 30 sauvegardes JSON datées (au plus une nouvelle version par minute de modifications). Les copies Markdown renommées ou retirées sont archivées. Ces copies ne sont pas synchronisées en direct avec un éditeur externe : utiliser **Importer des notes Markdown** pour reprendre des fichiers modifiés ailleurs.

Les exports JSON et Markdown restent disponibles. L’import JSON ajoute des projets sans remplacer les projets ouverts.

## Fonctions

- Projets indépendants : création, changement de projet, renommage, suppression confirmée, liste des notes par projet et mémorisation de chaque caméra.
- Les anciennes notes sont automatiquement conservées dans « Mon premier projet ». La recherche, les tags, les liens et les notes quotidiennes restent propres au projet actif.
- Export du projet actif ou de l’ensemble des projets. L’import ajoute des projets indépendants sans remplacer ceux qui existent.
- Graphe de notes avec rendu WebGL 3D, vue 2D, rotation, zoom et déplacement des nœuds.
- Nœuds sphériques éclairés, taille selon le nombre de connexions, filtre de voisinage, affichage des libellés, centrage sur une note et placement automatique avec annulation.
- Édition des notes, espaces, tags, favoris et recherche plein texte.
- Enregistrement automatique à chaque modification, aperçu Markdown et fin d’édition avec `Ctrl+S`.
- Mode Écrire avec éditeur agrandi, mentions entrantes et mise à jour des références lors du renommage d’un titre non ambigu.
- Corbeille pour restaurer des notes avec leurs liens disponibles et restaurer des projets supprimés.
- Import de fichiers Markdown depuis le sélecteur de fichiers du système.
- Titres, listes, gras, italique, code et tâches à cocher dans la vue de lecture.
- Connexions explicites et liens de type `[[Titre de note]]`.
- Les liens vers des notes existantes sont recalculés dans le graphe à chaque enregistrement ; retirer une référence retire sa connexion automatique, sans retirer les connexions manuelles.
- Journal du jour avec sections et cases à cocher.
- Export Markdown, sauvegarde et restauration du coffre en JSON.
- Menus de bureau et raccourcis `Ctrl+N`, `Ctrl+J`, `Ctrl+K` et `Ctrl+Shift+S`.

Dans le graphe : glisser le fond fait tourner la caméra ; la molette zoome ; `Maj` ou le bouton droit permettent le déplacement de la vue. Glisser un nœud déplace la note, `Alt` + glisser modifie sa profondeur et un double clic centre la caméra. `Ctrl+Shift+N` crée un projet.

### Identité Cosmos

Interface bleu nuit avec nébuleuses, étoiles en parallaxe lors de la rotation du graphe, repères orbitaux et palette de constellations. Le bouton **Ambiance** masque le décor et mémorise ce choix sur cet appareil. Le décor ne crée aucune note et ne fait tourner aucune animation en continu. Les polices utilisent les ressources du système, sans téléchargement externe.

### Galaxies et étoiles

Les notes existantes deviennent des galaxies sur la carte principale, sans perdre leur contenu. Double-cliquer une galaxie ouvre sa carte d’étoiles, initialement vide. Le bouton « Ouvrir la carte » offre le même accès au clavier. Chaque étoile est une note terminale : aucun troisième niveau ne peut être ouvert ou créé. « ← Galaxies » revient à la carte principale. Les liens, la corbeille, la recherche et le placement sont propres à la carte ouverte. Les sauvegardes JSON du projet comprennent les cartes d’étoiles ; leurs notes possèdent aussi une copie Markdown sur disque.

<img width="1508" height="950" alt="image" src="https://github.com/user-attachments/assets/b3524400-3f59-4a53-952e-061b30bc9a46" />

<img width="1508" height="950" alt="image" src="https://github.com/user-attachments/assets/25469139-a91e-4d0c-b7b8-2e3b03f9000b" />

-------------------------------------------------------------------
En cours: 
Amélioration des performance
Prise en charge de l'importation des export Notion
Amélioration globale de l'interface de note + un acceuile --> les graphe ne sont plus le centre de l'application 

