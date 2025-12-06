# Visage

Lire dans d'autres langues : [العربية](README-ar.md) • [English](README.md)

![Dernière version](https://img.shields.io/badge/Version-1.3.0-blue)
![Version de Foundry](https://img.shields.io/badge/Foundry_VTT-v13_%7C_v13-orange)
![Licence](https://img.shields.io/badge/License-MIT-yellow)
![Prise en charge RTL](https://img.shields.io/badge/RTL-Supported-green)
![Langues](https://img.shields.io/badge/Languages-3-blueviolet)
![Nombre de téléchargements](https://img.shields.io/github/downloads/Filroden/visage/total)
![Dernier commit](https://img.shields.io/github/last-commit/Filroden/visage)
![Problèmes](https://img.shields.io/github/issues/Filroden/visage)

**Visage** permet aux joueurs et aux MJ de changer instantanément l'apparence, la disposition et la configuration de l'anneau de jeton dynamique d'un jeton à la volée.

Les propriétaires peuvent configurer et **stocker plusieurs formes alternatives** (Visages) pour n'importe quel acteur — qui sont enregistrées de manière persistante et disponibles pour tous ses jetons liés dans toutes les scènes. À l'aide d'un **sélecteur HUD de jeton** personnalisé basé sur une grille, vous pouvez changer l'image et le nom du jeton, ajuster son échelle visuelle (par exemple, 150 % pour l'agrandir), retourner son orientation, appliquer une disposition (état « Amical », « Neutre », « Hostile » ou « Secret ») et reconfigurer complètement les paramètres de son anneau de jeton dynamique (couleurs, effets, texture du sujet).

Le module prend en charge :

* **tous les formats d'image ou de vidéo** valides pour les jetons.
* **prend en charge les chemins de fichiers avec des caractères génériques** (par exemple, `path/to/wolves/*.webp`), vous permettant de sélectionner une image aléatoire dans un dossier chaque fois que le **Visage** est activé.

Ce module le rend idéal pour un jeu dynamique sans nécessiter de modifications manuelles fastidieuses dans la fenêtre de configuration principale du jeton à chaque changement.

C'est le module parfait pour résoudre visuellement les mécanismes de jeu courants dans n'importe quel système. Utilisez **Visage** pour une application rapide des **illusions** et des **déguisements** qui changent l'apparence et le nom du jeton pour tromper les adversaires. Simplifiez les capacités de **métamorphose** en changeant visuellement vers une autre image en un seul clic. C'est également un excellent outil pour montrer des effets visuels, tels que le changement d'échelle pour représenter le jeton qui devient plus petit ou plus grand.

**Visage** augmente l'immersion et la vitesse de jeu en plaçant des commandes visuelles puissantes directement dans le HUD du jeton, offrant un **accès en un clic à toutes vos formes alternatives stockées**.

[Historique des versions](VERSION.md)

## Localisation et accessibilité

**Visage** est conçu pour être accessible :

* **Interface utilisateur réactive** : L'interface est entièrement réactive aux changements de la taille de police de base et s'adapte naturellement aux utilisateurs nécessitant un texte plus grand.
* **Prise en charge RTL native** : Inclut une prise en charge complète de la **droite à gauche (RTL)**. Si votre client Foundry est défini sur une langue RTL (par exemple, l'arabe, l'hébreu), l'interface utilisateur de Visage (sélecteur HUD, fenêtre de configuration et éditeur d'anneau dynamique) reflète automatiquement sa disposition pour garantir une expérience de lecture naturelle.
* **Langues** : Prend actuellement en charge l'arabe, l'anglais (États-Unis) et le français.

## Licence

Les logiciels et les fichiers de documentation associés dans ce référentiel sont couverts par une [licence MIT](LICENSE.md).

## Feuille de route

[Court terme]

* Localisation supplémentaire.

[Long terme]

* Ajouter la possibilité de créer et d'utiliser un répertoire mondial de visages, afin que certains effets puissent être appliqués rapidement à n'importe quel jeton (par exemple, les effets d'agrandissement/réduction).
* Tester le module avec FoundryVTT v14.

## Comment utiliser Visage

**Visage** facilite le changement de l'apparence, du nom et de l'état mécanique d'un jeton à la volée. Voici comment le configurer et l'utiliser.

### 1. Configuration des Visages

Avant de pouvoir changer de **Visages**, vous devez les définir pour un jeton. Ces **Visages** sont stockés sur l'acteur et sont disponibles pour tous les jetons de cet acteur.

1. **Ouvrir la configuration de Visage** : Faites un clic droit sur un jeton et choisissez l'icône **Visage** dans le HUD du jeton (un symbole de « changement de compte ») pour ouvrir le **sélecteur HUD de Visage**. Dans le coin supérieur droit, cliquez sur l'icône des paramètres (« rouage ») pour ouvrir la fenêtre de **configuration de Visage**.
2. **Vérifier les valeurs par défaut du Visage** :
    * La fenêtre de **configuration de Visage** affiche le nom et le chemin de l'image par défaut actuels du jeton. Ce sont les paramètres que le jeton aura lorsque son **Visage** est défini sur « Par défaut ».
    * Par défaut, ceux-ci sont hérités des paramètres principaux de l'acteur. Cependant, vous pouvez les remplacer en modifiant le nom/l'image/la disposition du jeton dans la fenêtre de configuration principale du jeton. **Visage** suit automatiquement ces changements.
3. **Ajouter des Visages alternatifs** :
    * Cliquez sur le bouton « **Ajouter un Visage** » pour créer une nouvelle forme alternative.
    * Pour chaque **Visage**, vous devez fournir :
        * **Nom** : Un nom pour le **Visage** (par exemple, « [Nom] (Forme de loup) », « [Nom] (Agrandi) », « Tonneau »). Ce nom sera également utilisé pour le nom du jeton lorsque ce **Visage** est actif, alors n'oubliez pas que c'est ce que les autres joueurs verront. **Ceci est facultatif**.
            * Si vous laissez ce champ vide, le Visage utilisera le nom par défaut actuel du jeton lorsqu'il sera appliqué.
            * Si vous fournissez un nom, il remplacera le nom du jeton comme d'habitude.
        * **Chemin de l'image** : Le chemin d'accès au fichier image pour ce **Visage**. **Ceci est facultatif**.
            * Si vous laissez ce champ vide, le Visage utilisera l'image par défaut actuelle du jeton lorsqu'il sera appliqué.
            * Vous pouvez utiliser l'icône de dossier pour ouvrir le sélecteur de fichiers. Les caractères génériques (`*`) sont pris en charge (par exemple, `path/to/images/wolf_*.webp`).
        * **Échelle** : Un facteur d'échelle en pourcentage (par exemple, `100 %`, `80 %`, `150 %`). Cela agrandira ou réduira visuellement l'image du jeton sur la toile sans changer sa taille réelle. La valeur par défaut est `100 %` (aucun changement).
        * **Retourner** : Si cette case est cochée, l'image sera retournée horizontalement.
        * **Disposition** : Contrôle la disposition du jeton (couleur de la bordure et interactivité) lorsque ce **Visage** est actif. À côté de la case à cocher Retourner, il y a un bouton **Disposition** montrant le paramètre actuel (par exemple, « Par défaut », « Déguisement : Amical », « Illusion : Secret »).
            * Cliquer sur ce bouton ouvre une fenêtre contextuelle où vous pouvez choisir l'une des substitutions suivantes :
                * **Par défaut (aucun changement)** : Le **Visage** n'affectera pas la disposition du jeton. Il conservera la disposition actuelle du jeton ou reviendra à sa disposition par défaut d'origine si vous revenez au **Visage** « Par défaut ».
                * **Se déguiser en** : Sélectionnez **Amical**, **Neutre** ou **Hostile**. Cela change la couleur de la bordure du jeton et la façon dont les autres pourraient le percevoir.
                * **Illusion (Secret)** : Règle le jeton sur l'état **Secret** (bordure violette pour le propriétaire, non interactif pour les autres). Ceci est mutuellement exclusif avec Amical/Neutre/Hostile.
        * **Anneau dynamique** : Cliquez sur le bouton Icône cible pour ouvrir l'éditeur d'anneau.
            * **Activer le remplacement de l'anneau** : Cochez cette case pour forcer des paramètres d'anneau spécifiques pour ce visage. Si cette case n'est pas cochée, le visage héritera des paramètres d'anneau actuels du jeton.
            * **Sujet** : Vous pouvez remplacer la texture utilisée à l'intérieur de l'anneau (laissez vide pour utiliser l'image principale du Visage) et ajuster indépendamment la correction de l'échelle du sujet.
            * **Couleurs** : Définissez la couleur de l'anneau et la couleur de l'arrière-plan.
            * **Effets** : Activez des animations d'anneau spéciales comme Pouls, Dégradé, Vague ou Invisibilité.
4. **Supprimer les Visages alternatifs** : Cliquez sur l'icône de la corbeille pour supprimer le **Visage**.
5. **Enregistrer les modifications** : Si vous apportez des modifications (ajoutez un nouveau **Visage**, modifiez une valeur dans un **Visage** existant ou supprimez un **Visage**), le bouton « Enregistrer les modifications » sera mis en surbrillance. Cliquer dessus enregistrera les modifications et fermera la fenêtre de **configuration de Visage**.

<img src="images/visage_configuration.png" alt="Fenêtre de configuration de Visage" width="500" style="display: block; margin: 0 auto;">
<br>
<img src="images/ring_editor.png" alt="Éditeur d'anneau dynamique de Visage" height="500" style="display: block; margin: 0 auto;">

### 2. Sélectionner un Visage

Une fois configuré, il est simple de basculer entre les **Visages**.

1. **Ouvrir le HUD du jeton** : Cliquez sur un jeton que vous avez configuré pour afficher le HUD du jeton.
2. **Cliquez sur l'icône Visage** : Vous verrez une icône (un symbole de « changement de compte »). Cliquez dessus pour ouvrir le **sélecteur HUD de Visage**.
3. **Choisir un Visage** : Une grille apparaîtra à côté du jeton montrant tous les **Visages** disponibles que vous avez configurés :
    * Le **Visage** « Par défaut » du jeton a une icône d'étoile dorée dans le coin supérieur gauche.
    * Le **Visage** actif est mis en surbrillance avec une icône de coche verte dans le coin supérieur droit.
    * Si un **Visage** a une échelle qui n'est pas de 100 % ou si le retournement est activé, cela sera affiché dans une puce sur la bordure supérieure.
    * Si un **Visage** utilise un caractère générique dans son chemin de fichier, il affichera une icône de lecture aléatoire bleue dans le coin inférieur gauche. Le sélectionner à nouveau choisira une autre image aléatoire.
    * Si un **Visage** change la disposition du jeton, une puce colorée apparaîtra en bas au centre indiquant l'état (par exemple, « Amical », « Hostile », « Secret »), correspondant aux couleurs de disposition de Foundry.
    * Si un **Visage** utilise un anneau de jeton dynamique, le **Visage** affichera l'anneau avec les couleurs, le style d'arrière-plan et les effets d'animation que vous avez configurés, vous donnant un aperçu immédiat de l'effet.
4. **Cliquez pour changer** : Cliquez simplement sur un **Visage** dans la grille. L'image, le nom, l'échelle, le retournement et la disposition du jeton se mettront instantanément à jour pour correspondre à votre sélection, et le sélecteur se fermera.

<img src="images/selector_hud.png" alt="Sélecteur HUD de Visage montrant les Visages disponibles et leurs modifications enregistrées" height="500" style="display: block; margin: 0 auto;">

### 3. Restaurer les valeurs par défaut

Pour ramener un jeton à son apparence d'origine :

1. Ouvrez le **sélecteur HUD de Visage** à partir du HUD du jeton.
2. Cliquez sur le **Visage** par défaut (marqué d'une étoile dorée dans le coin supérieur gauche).
3. Le jeton reviendra au nom, à l'image, à l'échelle, à l'état de retournement et à la disposition par défaut que **Visage** a automatiquement capturés pour lui.

### 4. Suppression de toutes les données liées à Visage

Pour les MJ, le module offre deux paramètres qui supprimeront toutes les données liées à Visage de tous les jetons d'une scène ou de tous les jetons de toutes les scènes. Utilisez-le avec prudence car il ne peut pas être annulé.

## Module Visage : Documentation de l'API publique

Le module **Visage** expose une API publique qui permet à d'autres modules, macros système ou utilisateurs avancés d'interagir par programme avec ses fonctionnalités de base, telles que le changement de formes d'acteurs.

L'API est accessible via `game.modules.get('visage').api`.

-----

### Accéder à l'API

Pour accéder à l'une des fonctions décrites ci-dessous, vous devez d'abord obtenir une référence à l'objet API :

```javascript
const visageAPI = game.modules.get('visage')?.api;

if (!visageAPI) {
    console.error("L'API Visage n'est pas disponible.");
    return;
}
// Vous pouvez maintenant appeler les fonctions, par exemple, visageAPI.setVisage(...)
```

-----

### Méthodes de l'API

#### 1. setVisage

La fonction principale pour changer le jeton spécifié vers la forme d'apparence spécifiée et appliquer ses substitutions configurées.

| Paramètre | Type     | Description                                                                                                                                                                                            |
| :-------- | :------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `actorId` | `string` | L'ID du document Acteur associé au jeton.                                                                                                                                                   |
| `tokenId` | `string` | L'ID d'un jeton spécifique sur la toile à mettre à jour immédiatement.                                                                                                                                |
| `formKey` | `string` | L'identifiant unique (UUID) de la forme d'apparence à laquelle basculer (par exemple, `"a1b2c3d4e5f6g7h8"`). Utilisez le littéral de chaîne `"default"` pour revenir à l'image, au nom, à l'échelle et à la disposition par défaut capturés du jeton. |

**Signature :**

```typescript
(actorId: string, tokenId: string, formKey: string): Promise<boolean>
```

**Retourne :**

* `Promise<true>` en cas de succès.
* `Promise<false>` si l'acteur, le jeton ou le `formKey` spécifié est introuvable, ou si la mise à jour échoue.

**Détails :**

Cette fonction met à jour la configuration `name`, `texture.src`, `texture.scaleX`, `texture.scaleY`, `disposition` et `ring` dynamique du jeton en fonction des données enregistrées pour le `formKey` spécifié. Si le `formKey` est `"default"`, il restaure les valeurs capturées automatiquement par Visage. Si la disposition configurée pour la forme est définie sur `"Par défaut (aucun changement)"` (`null` en interne), la disposition du jeton ne sera *pas* modifiée par cet appel lors du passage à cette forme. Si le visage enregistré a un nom ou un chemin d'image vide, cette fonction utilisera automatiquement le nom/l'image par défaut capturé du jeton à la place.

**Exemple :** Changer un jeton spécifique en une forme de « loup »

```javascript
visageAPI.setVisage("actor-id-12345", "token-id-67890", "a1b2c3d4e5f6g7h8");
```

#### 2. getForms

Récupère un tableau standardisé de tous les visages alternatifs disponibles pour un acteur donné.

| Paramètre | Type              | Description                                                                                                                                      |
| :-------- | :---------------- | :----------------------------------------------------------------------------------------------------------------------------------------------- |
| `actorId` | `string`          | L'ID du document Acteur à interroger.                                                                                                            |
| `tokenId` | `string` (optional) | L'ID d'un jeton spécifique. Si fourni, ses valeurs par défaut seront utilisées comme solutions de repli. Si omis, les données du jeton prototype de l'acteur seront utilisées à la place. |

**Signature :**

```typescript
(actorId: string, tokenId?: string): Array<object> | null
```

**Retourne :**

* Un `Array` d'objets de visage, où chaque objet a la structure suivante :
  * `key` (string) : L'identifiant unique interne (UUID) pour le visage.
  * `name` (string) : Le nom d'affichage résolu. Si le visage avait un nom vide, ce sera le nom par défaut (soit du jeton, soit du prototype).
  * `path` (string) : Le chemin du fichier image résolu. Si le visage avait un chemin vide, ce sera le chemin de l'image par défaut.
  * `scale` (number) : Le facteur d'échelle configuré pour le visage (par exemple, `1.0`, `1.2`, `-0.8`).
  * `disposition` (number | null) : La valeur de substitution de disposition configurée (`1` : Amical, `0` : Neutre, `-1` : Hostile, `-2` : Secret) ou `null` si le visage est défini sur « Par défaut (aucun changement) ».
  * `ring` (object | null) : L'objet de configuration de l'anneau dynamique. Contient { `enabled`, `subject`, `colors`, `effects` }. Renvoie null ou un objet vide si aucune substitution d'anneau n'est définie.
* Renvoie `null` si aucune forme alternative n'est définie ou si l'acteur est introuvable.

**Exemple 1 : Utilisation uniquement d'un ID d'acteur**

```javascript
// Cela utilisera le jeton prototype de l'acteur pour les solutions de repli
const forms = visageAPI.getForms("actor-id-12345");

// forms peut ressembler à :
// [ 
//   { 
//     key: "a1...", 
//     name: "Loup", 
//     path: "path/to/wolf.webp", 
//     scale: 1.2, 
//     disposition: -1,
//     ring: { enabled: false } // Anneau explicitement désactivé
//   }, 
//   { 
//     key: "b2...", 
//     name: "Forme spectrale", 
//     path: "path/to/ghost.webp", 
//     scale: 1.0, 
//     disposition: -2, // Secret
//     ring: { 
//        enabled: true, 
//        colors: { ring: "#00FF00", background: "#000000" }, 
//        effects: 2 // Pouls
//     } 
//   } 
// ]
```

#### 3. isFormActive

Vérifie si la forme d'apparence spécifiée est actuellement active sur un jeton spécifique.

| Paramètre | Type     | Description                                                                                     |
| :-------- | :------- | :---------------------------------------------------------------------------------------------- |
| `actorId` | `string` | L'ID du document Acteur associé au jeton.                                                         |
| `tokenId` | `string` | L'ID du jeton sur la toile à vérifier.                                                            |
| `formKey` | `string` | L'identifiant unique (UUID) de la forme d'apparence à vérifier (par exemple, `"default"`, `"a1b2c3..."`, etc.). |

**Signature :**

```typescript
(actorId: string, tokenId: string, formKey: string): boolean
```

**Retourne :**

* `true` si la clé de formulaire actuellement appliquée du jeton correspond à celle fournie, sinon `false`.

**Exemple :**

```javascript
if (visageAPI.isFormActive("actor-id-12345", "token-id-67890", "a1b2c3d4e5f6g7h8")) {
    console.log("Le jeton est dans sa forme par défaut.");
}
```

#### 4. resolvePath

Une fonction utilitaire pour résoudre un chemin de fichier pouvant contenir un caractère générique Foundry VTT (`*`) en un seul chemin d'image concret. Ceci est principalement utilisé pour afficher une seule image dans les aperçus de l'interface utilisateur.

| Paramètre | Type     | Description                                     |
| :-------- | :------- | :---------------------------------------------- |
| `path`    | `string` | Le chemin du fichier (qui peut inclure un caractère générique). |

**Signature :**

```typescript
(path: string): Promise<string>
```

**Retourne :**

* Une `Promise` qui se résout en chemin de fichier concret. Si le chemin ne contient pas de caractère générique, le chemin d'origine est renvoyé. Si la résolution échoue (par exemple, aucun fichier correspondant), le chemin d'origine est renvoyé comme solution de repli.

**Exemple :**

```javascript
const wildcardPath = "path/to/images/*.webp";
const resolved = await visageAPI.resolvePath(wildcardPath);
// resolved peut être : "path/to/images/wolf-03.webp"
```

-----

## Remarque sur les ID de jeton et d'acteur

Les méthodes de l'API Visage nécessitent généralement à la fois un `actorId` et un `tokenId` car les configurations de visage personnalisées sont stockées sur le document d'acteur, mais les modifications visuelles (image, nom, échelle, disposition) doivent être appliquées au document de jeton spécifique sur la toile. La forme actuellement active est également suivie par jeton.

Les méthodes de l'API Visage comme `setVisage` et `isFormActive` nécessitent à la fois un `actorId` et un `tokenId` car les configurations de visage personnalisées sont stockées sur le document d'acteur, mais les modifications visuelles (image, nom, échelle, disposition) doivent être appliquées au document de jeton spécifique sur la toile. La forme actuellement active est également suivie par jeton. La méthode `getForms` est une exception, car elle peut fonctionner avec juste un `actorId` (en se rabattant sur les données du jeton prototype), mais fournir un `tokenId` donnera des résultats plus précis pour les valeurs par défaut.

Vous pouvez obtenir de manière fiable les deux ID à partir de n'importe quelle instance de jeton sélectionnée (`token`) sur la toile en utilisant :

```javascript
const tokenId = token.id;
const actorId = token.actor.id; // Fonctionne pour les jetons liés et non liés
```
