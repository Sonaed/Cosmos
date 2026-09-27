# Cosmos — application de bureau
Fait par IA : J'apprend Python et Pyside actuellement afin de ne plus dépendre d'outil comme GPT mais le besoin de refaire des outils pour mon workflow était important 
Mon objectif est de réaliser mes outil moi-même et de les adapté au besoin que je peux avoir et qui pourrait interessé un plus grand nombre de personne 

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

### Intégration Existence

Cosmos reste un logiciel autonome, mais il est maintenant découvrable par Existence avec `existence-manifest.json` et `cosmos-desktop --existence-info`. Le protocole `existence.v1` décrit son identité, son cycle de vie, son répertoire de travail, ses capacités et `resource://existence/cosmos/workspace`. Dans la fenêtre desktop, le pont `window.cosmosExistence` permet à Existence de demander une description, vérifier la présence de Cosmos et interroger cette ressource sans dépendre de l’interface interne.

### Import Notion

Le menu **Fichier → Importer Notion** accepte un export Notion complet. Un export devient un seul projet Cosmos. Les pages racines deviennent des galaxies ; les pages imbriquées deviennent leurs étoiles terminales. Les tableaux HTML et fichiers CSV deviennent des données Notion avec vues Tableau et Kanban, les images sont conservées dans le dossier d’import du coffre et affichées dans les notes.

L’import conserve désormais chaque document par son chemin source, y compris les titres identiques, les fichiers Markdown et les pages sans racine correspondante. Les identifiants techniques Notion sont retirés des titres affichés. Les images relatives sont résolues depuis le fichier d’origine, y compris celles des propriétés. Le HTML est converti en Markdown structuré et inerte (titres, liens, listes, tableaux, code et images) ; les fichiers sources restent dans le dossier d’import.

Les CSV disposent de cellules éditables, d’un filtre, d’une pagination de 100 lignes sans troncature des données, d’ajout de lignes et de colonnes, d’un export CSV et d’un Kanban regroupé par une propriété au choix. Modifier la propriété ou déplacer une carte change sa colonne. Les valeurs, colonnes et propriétés sont conservées dans les sauvegardes JSON. Les types des propriétés, formules, automatisations et configurations de vues absents de l’export ne peuvent pas être reconstruits à partir du CSV : les valeurs exportées sont conservées comme texte.

Le mode Écrire propose des boutons de mise en forme et un aperçu Markdown ouvert. Pour récupérer les contenus perdus par une ancienne importation, réimporter le ZIP dans un nouveau projet ; les projets existants ne sont pas remplacés. Les images restent liées au dossier d’import local : un export JSON seul ne transfère pas les fichiers joints vers un autre ordinateur.

Tests : `cosmos-desktop --smoke-check` vérifie les fonctions générales et la restauration native dans un coffre temporaire ; `cosmos-desktop --notion-check` vérifie les cas CSV, HTML, Markdown, hiérarchie, images, édition, Kanban, pagination et sauvegarde. Le second test utilise `tests/notion-check.js` depuis le dossier des sources. `COSMOS_NOTION_FIXTURE` permet de fournir un JSON `{root,pages}` extrait d’un export réel pour contrôler chaque document.

### Navigation et performances (révision septembre 2026)

- **Documents** affiche les pages sur toute la largeur, avec dossiers, recherche sur tout le projet et navigation indépendante du graphe. **Graphe** affiche la carte. **Écrire** modifie seulement la note ouverte et ne change pas de mode.
- La bordure droite du panneau gauche se déplace à la souris ou avec les flèches du clavier après sélection. Sa largeur est mémorisée.
- La liste affiche 80 pages à la fois et le graphe au maximum 350 nœuds. Les autres notes restent accessibles par les dossiers, la pagination et la recherche. Le graphe indique cette limite.
- La saisie met à jour la note en mémoire immédiatement ; l’aperçu et la sauvegarde sont regroupés après une courte pause. Les écritures disque s’effectuent dans un travailleur C++ et les copies Markdown inchangées ne sont plus relues. La fermeture attend la dernière sauvegarde.
- Le moteur Markdown embarqué est markdown-it 14.1.0 (licence MIT dans `vendor/`). Aucun CDN n’est chargé à l’exécution. Les propriétés et images référencées comme chemins texte dans l’export Markdown sont récupérées ; le document source peut être consulté séparément.
- On peut sélectionner **les deux ZIP HTML et Markdown ensemble** dans Importer Notion : les pages partageant un identifiant Notion sont réunies, le Markdown fournit le corps, les propriétés et images HTML complètent la page. Les CSV identiques des deux archives sont réunis ; les versions différentes restent conservées. Les liens des deux exports restent utilisables. Chaque import crée un nouveau projet et ne remplace pas les notes existantes.
- L’import affiche sa progression et peut être annulé pendant la conversion, avant l’ajout du projet. Les tables peuvent ouvrir la page correspondant à une ligne lorsque celle-ci est identifiée sans ambiguïté.

`--close-check` teste la fermeture immédiate après une frappe. Les contrôles Notion mesurent également 100 modifications successives, les changements de mode, la largeur du panneau, la pagination, l’annulation et la conservation des sources fusionnées.

### Révision performances et outils (fin septembre 2026)

**Moteur du graphe** (`graph-engine.js`)
- Le graphe 2D/3D est entièrement dessiné par la carte graphique : un seul tampon pour les nœuds, un pour les liens. Tourner, zoomer ou déplacer la vue ne change que la caméra, sans reconstruire la scène : un coffre de 5 000 notes reste fluide. La limite de 350 nœuds est supprimée (jusqu’à 30 000 affichés).
- Les galaxies spirales sont dessinées dans un shader (plus aucun élément SVG par note). Les libellés passent sur un seul canevas, avec priorité à la note ouverte, au survol et aux plus connectées, et sans chevauchement ni passage sous les barres d’outils.
- Pendant un mouvement de caméra, le nombre de liens dessinés s’adapte à la vitesse de la machine, puis tout est redessiné à l’arrêt.
- La caméra n’est plus sérialisée à chaque cran de molette : sa sauvegarde est regroupée après le geste (et forcée à la fermeture).
- Degrés, voisinage et compteurs sont calculés en une passe (auparavant quadratiques). Le tri des listes utilise un comparateur mis en cache.
- « Organiser » utilise une simulation de forces à grille spatiale (répulsion proche exacte + champ lointain par centres de masse), avec aperçu en direct, `Échap` pour arrêter et cadrage automatique à la fin.
- Si le cache local du navigateur est plein, Cosmos arrête d’y réécrire le coffre et s’appuie sur la sauvegarde native.

**Outils**
- Survol d’une note : infobulle (extrait, connexions, étoiles) et mise en valeur de son voisinage.
- Clic droit sur une note : ouvrir, écrire, ouvrir la carte, centrer, relier/délier à la note ouverte, favori, corbeille.
- Molette : zoom vers le curseur. Bouton ⤢ / `F` : tout voir. Caméra animée pour centrer ou réinitialiser.
- **Filtres** : panneau avec recherche dans le graphe, espaces, favoris, récents, notes isolées et voisinage ; pastille quand un filtre est actif.
- **Ctrl+K** devient une palette : résultats classés (titre avant contenu) avec extrait surligné, navigation au clavier, création d’une note depuis la recherche, et commandes avec `>`.
- Éditeur : suggestions en tapant `[[`, `Ctrl+B` / `Ctrl+I`, continuation automatique des listes et cases à cocher, compteur de mots.
- « Relier une note » : champ de recherche sur tout le projet au lieu d’une liste limitée à 100 titres.
- `?` affiche tous les raccourcis : `N` note, `J` journal, `G` documents/graphe, `E` écrire, `F` tout voir, `C` centrer, `0` caméra, `2`/`3` vues, `L` libellés, `O` organiser, `Retour` sortir d’une galaxie, `Suppr` corbeille.

### Coffre, suppression de projets et import Notion (révision)

- **Fichier → Ouvrir le dossier du coffre** / **Changer le dossier du coffre…**, aussi accessibles depuis l’indicateur « Sauvegardé sur disque » du panneau gauche et depuis Ctrl+K. Un dossier vide reçoit une copie du coffre ; un dossier contenant déjà `workspace.json` est ouvert tel quel. Cosmos redémarre pour basculer ; « Dossier par défaut » revient à l’emplacement d’origine. Les fichiers Notion déjà importés restent lisibles depuis l’ancien emplacement.
- La suppression d’un projet ne dépend plus du cache local du navigateur (elle échouait silencieusement quand ce cache était plein, avec un gros import Notion). Le dernier projet peut aussi être supprimé : un projet vide le remplace. La restauration d’un projet supprimé ne vide plus les autres projets archivés.
- Import Notion : les archives internes (`…Part-1.zip`, `…Part-2.zip` des gros exports) sont décompressées puis supprimées. Un import annulé, vide ou en échec efface son dossier temporaire.
- Au démarrage, Cosmos supprime les rapports de test laissés dans `/tmp` (`cosmos-*.txt/png/json`), les dossiers d’import Notion vides et les ZIP restés dans `notion-import`.

## Atelier Cosmos (interface type Notion / Obsidian)

Cosmos s’ouvre maintenant sur un **atelier** : les pages d’abord, le graphe en onglet.

- **Panneau gauche** : menu du projet (changer de projet, créer, renommer, supprimer, importer Notion / Markdown / JSON, exporter, dossier du coffre), recherche, boutons Page · Journal · Graphe · Accueil, **Favoris**, **arborescence des pages** (profondeur illimitée, glisser-déposer pour ranger une page dans une autre, clic droit ou « ⋯ » pour les actions, ＋ pour une sous-page) et **Tags** (tags de la page et `#tags` écrits dans le texte).
- **Onglets** : plusieurs pages ouvertes, Ctrl+clic ou clic molette pour un nouvel onglet, glisser pour réordonner, Ctrl+T / Ctrl+W / Ctrl+Tab. Les onglets sont mémorisés par projet.
- **Éditeur par blocs** : on clique n’importe où dans la page pour écrire, directement. `/` ouvre le menu des blocs (titres, listes, tâches, bloc dépliant, encadré, citation, code, tableau, séparateur, lien, sous-page, base de données, image, date). `[[` propose les pages à lier. Entrée crée un bloc, ↑/↓ passent d’un bloc à l’autre, Retour arrière fusionne. La poignée ⋮⋮ déplace un bloc (glisser) ou le transforme, le duplique, le supprime. Titre, icône, espace, tags et propriétés s’éditent en haut de page.
- **Bases de données** : propriétés typées (texte, nombre, sélection, statut, multi-sélection, date, case à cocher, lien, e-mail, personne, relation…), vues **Tableau, Kanban, Calendrier, Galerie, Liste**, filtres, tris, propriétés masquables, fiche d’une ligne, page associée à chaque ligne, export CSV. Les types sont reconnus automatiquement à l’import.
- **Panneau droit** : plan de la page, mentions entrantes, liens sortants (avec création des pages manquantes), connexions du graphe et infos (source Notion consultable). Dans le graphe, il affiche l’aperçu de l’étoile sélectionnée et un bouton « Ouvrir la page ».
- **Accueil** et **Recherche plein écran** (Ctrl+Maj+F, `#tag` pour filtrer).

### Import Notion amélioré

- Listes imbriquées sur plusieurs niveaux, listes numérotées, cases à cocher, blocs dépliants (toggle), encadrés (callout) avec leur emoji et leur couleur, code avec langage, équations, images avec légende, signets, liens vers des pages, colonnes, tableaux simples.
- Icône et image de couverture des pages conservées.
- Bases de données HTML reconstruites avec le **type exact de chaque propriété** ; bases Markdown/CSV typées automatiquement. Les deux CSV d’une même base (`…csv` et `…_all.csv`) ne créent plus de doublon : la version complète est gardée. Les relations `Page (Page%20id.md)` deviennent `Page`.
- Les liens entre pages importées deviennent des liens `[[Page]]` (quand le titre est unique), donc cliquables, visibles dans les mentions et dans le graphe.
- Import combiné HTML + Markdown : icônes, types et liens vers les lignes sont fusionnés.

### Performances (révision finale)

- Changer de page ne réécrit plus tout le coffre et ne recalcule plus les listes cachées de l’ancienne interface : ouverture d’une page ≈ 20 ms sur 5 000 pages (au lieu de ≈ 55 ms).
- Index de navigation (liens Notion) construits seulement au premier besoin ; titres des liens `[[…]]` mis en cache ; mentions entrantes mises en cache.
- Saisie du titre : l’arborescence se met à jour après une courte pause, plus à chaque lettre.
- Sauvegarde : regroupée après 1,2 s de pause. Au-delà de ~4,5 Mo, le coffre n’est plus copié dans le cache du navigateur (inutile et lent) : le fichier natif fait foi. Côté C++, la vérification du JSON se fait dans le fil d’écriture, plus dans l’interface. Les gros coffres (> 20 Mo) gardent 10 sauvegardes datées au lieu de 30.
  

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

<img width="1508" height="950" alt="image" src="https://github.com/user-attachments/assets/b3524400-3f59-4a53-952e-061b30bc9a46" />

<img width="1508" height="950" alt="image" src="https://github.com/user-attachments/assets/25469139-a91e-4d0c-b7b8-2e3b03f9000b" />
