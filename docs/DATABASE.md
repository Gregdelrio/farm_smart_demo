# FarmSmart : la base de données, table par table

> État : schéma prévu, **pas encore installé** sur Supabase. Le script se lance une seule fois, en même temps que la mise en ligne du nouveau code des tuiles.

Source : [001_simplified_schema.sql](../supabase/migrations/001_simplified_schema.sql). PK = clé primaire (ce qui identifie une ligne de façon unique). FK = clé étrangère (une colonne qui pointe vers une ligne d'une autre table ; la base refuse un lien vers une ligne qui n'existe pas).

## 1. Les tables et leurs colonnes

### companies : la société cliente
| Colonne | Explication |
|---|---|
| `id` | PK, numéro unique automatique (UUID) |
| `name` | Nom : Moloney Sharefarming Trust |
| `state` | État australien (VIC) : sert à choisir les jours fériés |
| `xero_tenant_id` | Identifiant de l'organisation Xero, rempli à la connexion |
| `pay_anchor` | Un lundi qui commence une quinzaine de paie (14/09/2026) |
| `ot_threshold_hours` | Seuil d'overtime : 152 h |
| `cycle_days` | Longueur du cycle d'overtime : 28 jours |
| `weekly_days_off` | Roster : nombre de jours off par semaine |
| `couple_shared_day_off` | Roster : les couples ont-ils leur jour off ensemble |
| `created_at`, `updated_at` | Dates de création et de dernière modification |

### farms : les fermes
| Colonne | Explication |
|---|---|
| `id` | PK |
| `company_id` | FK → companies : à quelle société appartient la ferme |
| `code` | Petit nom lisible (`maguires`), unique dans la société |
| `name` | Nom affiché |
| `farm_type` | Dairy par défaut |
| `owner_first_name` | Prénom du propriétaire du terrain (Peter, John, Damian) |
| `herd_size` | Taille du troupeau |
| `road_name` | Route (tuile Road Crossing) |
| `lat`, `lng` | Position GPS du centre (Shift Clock, Farm Plan) |
| `color` | Couleur dans le Roster |
| `min_staff`, `ideal_staff`, `max_staff` | Roster : personnes minimum, idéal, maximum. Contrôle : min ≤ idéal ≤ max |
| `exempt_from_minimum` | Roster : la ferme peut descendre sous le minimum |
| `sort_order` | Ordre d'affichage |
| `active` | Faux = ferme retirée (jamais supprimée) |
| `updated_at` | Dernière modification |

### employees : les employés
| Colonne | Explication |
|---|---|
| `id` | PK |
| `company_id` | FK → companies |
| `code` | Petit nom lisible (`greg`), unique dans la société |
| `preferred_name` | Prénom affiché |
| `partner_id` | FK → employees : son conjoint, s'il travaille aussi ici |
| `employment_type` | `casual` ou `permanent` (seules valeurs acceptées) |
| `classification` | Niveau de l'award (FLH1) |
| `xero_employee_id` | Son identifiant dans Xero, unique |
| `app_role` | Rôle dans l'app (repris de l'ancienne table) |
| `start_date` | Date d'arrivée |
| `end_date` | Dernier jour travaillé ; vide = toujours employé. Contrôle : après `start_date` |
| `cycle_start` | Un lundi qui commence son cycle d'overtime de 4 semaines |
| `sort_order` | Ordre d'affichage |
| `updated_at` | Dernière modification |

### employee_farms : qui est formé sur quelle ferme
| Colonne | Explication |
|---|---|
| `employee_id` | FK → employees |
| `farm_id` | FK → farms |

PK = les deux ensemble : on ne peut pas mettre deux fois la même ferme au même employé.

### roster_shifts : le planning (qui DEVRAIT travailler)
| Colonne | Explication |
|---|---|
| `employee_id` | FK → employees |
| `work_date` | Le jour |
| `farm_id` | FK → farms. Vide = jour off. Pas de ligne = pas encore planifié |
| `updated_at` | Dernière modification |

PK = employé + jour : une seule affectation par personne et par jour.

### timesheet_shifts : les heures réelles (qui A travaillé)
| Colonne | Explication |
|---|---|
| `id` | PK |
| `employee_id` | FK → employees (jamais supprimé en cascade : l'historique de paie est protégé) |
| `farm_id` | FK → farms : où il a travaillé ce jour-là |
| `work_date` | Le jour. Unique avec `employee_id` : une ligne par personne et par jour |
| `hours` | Total du jour, seulement quand les horaires précis sont inconnus |
| `status` | `on` (en cours), `break` (en pause) ou `complete` (terminé) |
| `gps_checks` | Positions GPS relevées à chaque pointage |
| `source` | D'où vient la ligne : `clock` (Shift Clock), `import`, `manual` ou `demo` |
| `note` | Remarque libre |
| `updated_at` | Dernière modification |

### timesheet_segments : les morceaux de travail d'une journée
| Colonne | Explication |
|---|---|
| `shift_id` | FK → timesheet_shifts : la journée concernée |
| `start_time` | Heure de début du morceau |
| `end_time` | Heure de fin ; vide = il travaille encore. Contrôle : après le début |

PK = journée + heure de début. Les pauses sont les trous entre deux morceaux : 04:30–10:15 puis 13:00–16:20 = une pause de 10:15 à 13:00. Une seule journée peut avoir un seul morceau « en cours » à la fois. Limite connue : un travail qui passe minuit n'est pas géré.

### timesheet_approvals : quinzaines validées
| Colonne | Explication |
|---|---|
| `employee_id` | FK → employees |
| `fortnight_start` | Le lundi de début de la quinzaine |
| `approved_at` | Date d'approbation |
| `sent_at` | Date d'envoi à Xero |

PK = employé + quinzaine.

### public_holidays : jours fériés
| Colonne | Explication |
|---|---|
| `holiday_date` | Le jour |
| `state` | L'État (VIC) |
| `name` | Nom du jour férié |

PK = jour + État.

### farm_plans : la photo du plan de chaque ferme
| Colonne | Explication |
|---|---|
| `farm_id` | PK et FK → farms : un seul plan par ferme |
| `image_path` | Adresse de la photo |
| `img_w`, `img_h` | Largeur et hauteur de la photo en pixels |
| `updated_at` | Dernière modification |

### farm_plan_refs : les points GPS de calibrage du plan
| Colonne | Explication |
|---|---|
| `id` | PK |
| `farm_id` | FK → farm_plans |
| `name` | Nom du point |
| `lat`, `lng` | Position GPS réelle |
| `u`, `v` | Position du même point sur la photo |
| `updated_at` | Dernière modification |

### farm_plan_paddocks : les paddocks placés sur le plan
| Colonne | Explication |
|---|---|
| `id` | PK |
| `farm_id` | FK → farm_plans |
| `name` | Nom du paddock |
| `status` | État du paddock (texte libre saisi dans Farm Plan) |
| `last_grazed` | Date du dernier pâturage |
| `notes` | Remarques |
| `u`, `v` | Position sur la photo |
| `updated_at` | Dernière modification |

## 2. Les liens entre les tables

```
companies ──< farms ──────────< farm_plans ──< farm_plan_refs
    │           │                    └──────< farm_plan_paddocks
    │           ├──< employee_farms >──┐
    │           ├──< roster_shifts >───┤
    │           └──< timesheet_shifts >┤ ──< timesheet_segments
    └──< employees ────────────────────┘
             ├──< timesheet_approvals
             └── partner_id → employees (lui-même)
public_holidays : reliée aux sociétés par l'État (VIC), pas par une FK
```

`A ──< B` veut dire « une ligne de A, plusieurs lignes de B ». Chaque flèche est une FK : la base refuse par exemple un planning pour un employé qui n'existe pas.

## 3. Les formes normales, en rappel

- **1FN (première forme normale)** : chaque case contient **une seule valeur**, pas une liste. Exemple interdit : « fermes formées = laang, vickers » dans une seule case.
- **2FN** : 1FN, et quand la clé est faite de plusieurs colonnes, chaque autre colonne dépend de **toute** la clé, pas d'une partie. Exemple interdit : mettre le nom de l'employé dans `roster_shifts`, dont la clé est employé + jour : le nom ne dépend que de l'employé.
- **3FN** : 2FN, et aucune colonne ne dépend d'une **autre colonne qui n'est pas la clé**. Exemple interdit : mettre le nom de la ferme dans `employees` à côté de l'identifiant de la ferme : le nom dépend de la ferme, pas de l'employé.

## 4. Verdict

**2FN et 3FN : respectées.** Les tables à clé double (`employee_farms`, `roster_shifts`, `timesheet_approvals`, `public_holidays`) n'ont que des colonnes qui dépendent de la clé entière. Aucune information n'est recopiée d'une table à l'autre : le nom d'une ferme n'existe que dans `farms`, celui d'un employé que dans `employees`.

**1FN : respectée, avec une seule exception volontaire.** Les horaires ont leur propre table (`timesheet_segments`), où la base refuse une heure invalide ou une fin avant le début. Reste `gps_checks`, un petit journal de positions dans `timesheet_shifts` : on ne fait jamais de recherche dedans, on l'affiche seulement, donc le garder en un bloc est raisonnable.

**Deux points d'attention, sans enfreindre la 3FN :**
- Un couple est enregistré des deux côtés (Ani → Junior et Junior → Ani). L'app doit toujours mettre à jour les deux fiches ensemble.
- Avec le bouton unique « Approuver et envoyer à Xero », `approved_at` et `sent_at` auront la même date une fois Xero branché. On garde les deux tant que Xero n'est pas connecté, puisque d'ici là on peut approuver sans envoyer.
