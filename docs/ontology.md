# Ontology of the office

This file is the **source of truth** for the context model. The API reads it at start and again whenever it changes:
the Schema view is drawn from it, and the watcher checks the live data against it.
Edit the prose freely. Keep the structure below, or the API reports an error on the Context page and keeps the last valid version.

## How this file is read

- Each entity is a level-2 heading (`## Name`), followed by a list with `id`, `group` and `de` (German name).
- The paragraph after the list is the entity's description.
- `**Fields**` is followed by a table: `Field | Type | Description`.
- `**Relations**` is followed by a table: `Relation | Label (en / de) | To | Cardinality | Kind | Description`.
  - **Relation** is the id in backticks. The same id may be used between different pairs of entities.
  - **To** is the heading of another entity (or this one).
  - **Cardinality** reads `from → to`: how many of *this* entity one target has, then how many targets one of *this* has.
    Allowed values: `1`, `0..1`, `0..*`, `1..*`. Example: Process `has_step` Step is `1 → 1..*`: every step belongs to exactly one process, every process has at least one step.
  - **Kind** is `stated` (in the data), `derived` (inferred, for example the reporting line) or `shortcut` (follows from other relations; not drawn in the Schema view).
- Groups: `organisation`, `process`, `rules`, `documents`, `systems`, `federal`.
- A new entity or relation here appears in the Schema view right away. It only gets items in the graph once the API knows how to read them from the data (`apps/api/src/ontology.ts`); until then it shows a count of 0.

---

## Office
- id: `office`
- group: organisation
- de: Amt

The student services office that runs processes and employs the staff. One office per installation; other offices appear as *Other office*.

**Fields**

| Field | Type | Description |
|---|---|---|
| name | text | Name of the office |
| languages | list | Languages the office answers in |
| slaDays | number | Target for the first reply, in days |

**Relations**

| Relation | Label (en / de) | To | Cardinality | Kind | Description |
|---|---|---|---|---|---|
| `runs` | runs / betreibt | Process | 0..1 → 0..* | stated | The office runs its published processes |

## Person
- id: `person`
- group: organisation
- de: Person

A member of staff, or the oversight body. People own, write and approve things; they never act anonymously.

**Fields**

| Field | Type | Description |
|---|---|---|
| name | text | Full name |
| title | text | Job title |

**Relations**

| Relation | Label (en / de) | To | Cardinality | Kind | Description |
|---|---|---|---|---|---|
| `heads` | heads / leitet | Office | 0..1 → 0..1 | stated | The administrator heads the office |
| `oversees` | oversees / beaufsichtigt | Office | 0..* → 0..* | stated | The oversight body looks at the office from outside |
| `reports_to` | reports to / berichtet an | Person | 0..* → 0..1 | derived | Reporting line; the data has no org chart, so everyone reports to the administrator |
| `deputizes_for` | deputizes for / vertritt | Person | 0..* → 0..* | stated | Who takes the cases of someone who is away (assignment table) |
| `has_role` | has role / hat Rolle | Role | 1..* → 0..* | stated | The permissions a person holds |
| `owns` | owns / verantwortet | Process | 0..1 → 0..* | stated | Responsible for a process |
| `owns` | owns / verantwortet | Template | 0..1 → 0..* | stated | The extractor owner is responsible for templates |
| `wrote` | wrote / hat geschrieben | Rule | 0..* → 0..* | stated | Author of a rule version |
| `approved` | approved / hat freigegeben | Rule | 0..* → 0..* | stated | Second person who approved a rule version |
| `wrote` | wrote / hat geschrieben | Message template | 0..* → 0..* | stated | Author of a message version |
| `approved` | approved / hat freigegeben | Message template | 0..* → 0..* | stated | Second person who approved a message version |
| `proposed` | proposed / hat vorgeschlagen | Template proposal | 1 → 0..* | stated | Who proposed a new template |
| `administers` | administers / verwaltet | Connector | 0..* → 0..* | stated | Administrators switch connections on and off |
| `maintains` | maintains / pflegt | Reference model | 0..* → 0..* | stated | The oversight body maintains the reference model |

## Role
- id: `role`
- group: organisation
- de: Rolle

A set of permissions: caseworker, process designer, administrator, extractor owner, oversight. The API enforces them.

**Fields**

| Field | Type | Description |
|---|---|---|
| name | text | Name of the role |

## Team
- id: `team`
- group: organisation
- de: Team

A group a process can route cases to, for example "Team Ausland".

**Fields**

| Field | Type | Description |
|---|---|---|
| name | text | Name of the team |

## Process
- id: `process`
- group: process
- de: Prozess

A process the office draws in the builder: one per entry of the process catalogue. It has a live version and possibly a draft.

**Fields**

| Field | Type | Description |
|---|---|---|
| name | text | Name of the process |
| version | number | Live version |
| state | live / draft / changed | Changed means live with a draft waiting |
| owner | text | Responsible person |
| changeNote | text | Why this version was published |

**Relations**

| Relation | Label (en / de) | To | Cardinality | Kind | Description |
|---|---|---|---|---|---|
| `has_step` | has step / hat Schritt | Step | 1 → 1..* | stated | The steps the process is drawn from |
| `asks` | asks / fragt | Field | 0..* → 0..* | stated | Questions the applicant answers |
| `requires` | requires / verlangt | Template | 0..* → 0..* | stated | Forms the applicant must upload |
| `implements` | implements / setzt um | Catalogue entry | 0..* → 1 | stated | Every process belongs to exactly one catalogue variant |
| `uses_rule` | checks with rule / prüft mit Regel | Rule | 0..* → 0..* | shortcut | Through its "run rules" steps |
| `sends` | sends / sendet | Message template | 0..* → 0..* | shortcut | Through its message steps |
| `calls` | calls / ruft auf | Connector | 0..* → 0..* | shortcut | Through its connector steps |

## Step
- id: `step`
- group: process
- de: Schritt

One box in a process: check rules, read documents, caseworker decides, call a system, send a message, and so on.

**Fields**

| Field | Type | Description |
|---|---|---|
| name | text | Name shown in the builder |
| kind | step kind | What the step does |
| purpose | text | Why the step is there |
| config | settings | Settings of the step |

**Relations**

| Relation | Label (en / de) | To | Cardinality | Kind | Description |
|---|---|---|---|---|---|
| `next` | then / danach | Step | 0..* → 0..* | stated | The order of steps |
| `uses_rule` | checks with rule / prüft mit Regel | Rule | 0..* → 0..* | stated | Rules a "run rules" step applies |
| `sends` | sends / sendet | Message template | 0..* → 0..1 | stated | The message a step sends |
| `calls` | calls / ruft auf | Connector | 0..* → 0..1 | stated | The system a connector step calls |
| `invokes` | invokes / führt aus | Action | 0..* → 0..1 | stated | The action it runs on that system |
| `routes_to` | routes to / leitet an | Team | 0..* → 0..1 | stated | Team a routing step hands the case to |
| `provides` | provides / liefert | Data item | 0..* → 0..* | stated | Data the step produces, for example the decision |

## Message template
- id: `message`
- group: process
- de: Nachrichtenvorlage

A text sent to applicants, written once and approved by a second person, used by many steps.

**Fields**

| Field | Type | Description |
|---|---|---|
| name | text | Name of the template |
| version | number | Approved version |
| subject | de / en | Subject line |
| body | de / en | Text with placeholders |
| state | live / draft | Whether a change waits for approval |

## Rule
- id: `rule`
- group: rules
- de: Regel

A check on an application. Federal rules come from the law; office rules are local. Every change needs a second person.

**Fields**

| Field | Type | Description |
|---|---|---|
| id | text | Stable id, for example R-HOST-CONFIRM |
| title | de / en | Readable name |
| version | number | Live version |
| scope | federal / office | Where the rule comes from |
| severity | blocker / warning | Whether it stops the application |
| state | live / draft / paused | Lifecycle |

**Relations**

| Relation | Label (en / de) | To | Cardinality | Kind | Description |
|---|---|---|---|---|---|
| `based_on` | based on / beruht auf | Legal source | 0..* → 0..1 | stated | The paragraph or guideline the rule rests on |
| `reads` | reads / liest | Field | 0..* → 0..* | stated | Fields the rule's conditions look at |
| `reads` | reads / liest | Template | 0..* → 0..* | stated | "Was this form uploaded?" |

## Legal source
- id: `source`
- group: rules
- de: Rechtsquelle

A paragraph of the law or an administrative guideline that rules rest on.

**Fields**

| Field | Type | Description |
|---|---|---|
| label | text | For example "§ 16 BAföG" |
| url | link | Where to read it |

## Template
- id: `template`
- group: documents
- de: Vorlage

A form or document the office can read, such as Formblatt 1. A process may only require confirmed templates.

**Fields**

| Field | Type | Description |
|---|---|---|
| name | de / en | Name of the template |
| formblatt | text | Official form number |
| title | text | Title as printed; the reader recognises the form by it |
| providedBy | student / parents / … | Who supplies the document |
| confirmed | yes / no | Tested with a sample and confirmed |

**Relations**

| Relation | Label (en / de) | To | Cardinality | Kind | Description |
|---|---|---|---|---|---|
| `has_field` | has field / hat Feld | Field | 0..1 → 0..* | stated | Fields and signatures read from the document |

## Field
- id: `field`
- group: documents
- de: Feld

A single piece of information: a field or signature on a template, a fact of the application (stay, dates), or a question of a process.

**Fields**

| Field | Type | Description |
|---|---|---|
| key | text | Technical name |
| label | text | Readable name |
| type | text / number / date / yesno | Kind of value |
| required | yes / no | Must be filled |

**Relations**

| Relation | Label (en / de) | To | Cardinality | Kind | Description |
|---|---|---|---|---|---|
| `provides` | provides / liefert | Data item | 0..* → 0..* | stated | A field that supplies data a connector needs |

## Data item
- id: `data`
- group: documents
- de: Datenpunkt

Data a connector action needs, and where it can come from: the system, the application, a decision, or collected from the applicant. Used for lineage.

**Fields**

| Field | Type | Description |
|---|---|---|
| id | text | For example bank.iban |
| label | de / en | Readable name |
| source | system / application / decision / collected | Where it comes from |

## Template proposal
- id: `proposal`
- group: documents
- de: Vorlagenvorschlag

A new template a process designer proposes; the extractor owner accepts or rejects it.

**Fields**

| Field | Type | Description |
|---|---|---|
| name | text | Proposed name |
| status | draft / submitted / … | Where the proposal stands |
| proposedAt | date | When it was proposed |

## Connector
- id: `connector`
- group: systems
- de: Verbindung

The office's connection to another system: case software, e-file, payment, portal.

**Fields**

| Field | Type | Description |
|---|---|---|
| name | de / en | Name of the system |
| enabled | yes / no | Switched on |
| mode | sandbox / live | Test or real system |
| lastTest | date, ok | Last connection test |

**Relations**

| Relation | Label (en / de) | To | Cardinality | Kind | Description |
|---|---|---|---|---|---|
| `offers` | offers / bietet | Action | 1 → 1..* | stated | What the system can do |

## Action
- id: `action`
- group: systems
- de: Aktion

One thing a connector can do, for example "create payment order". Its data contract says what it needs.

**Fields**

| Field | Type | Description |
|---|---|---|
| id | text | For example create_payment_order |
| label | de / en | Readable name |

**Relations**

| Relation | Label (en / de) | To | Cardinality | Kind | Description |
|---|---|---|---|---|---|
| `needs` | needs / braucht | Data item | 0..* → 0..* | stated | The data contract of the action |

## Catalogue entry
- id: `catalog`
- group: federal
- de: Katalogeintrag

An entry of the central process catalogue: domain › service › variant. It makes the same process comparable across offices.

**Fields**

| Field | Type | Description |
|---|---|---|
| id | text | For example bafoeg.abroad |
| title | de / en | Readable name |
| level | domain / service / variant | Place in the catalogue |

**Relations**

| Relation | Label (en / de) | To | Cardinality | Kind | Description |
|---|---|---|---|---|---|
| `part_of` | part of / gehört zu | Catalogue entry | 0..* → 0..1 | stated | Variant in service, service in domain |

## Other office
- id: `peer`
- group: federal
- de: Anderes Amt

Another student services office, compared by the oversight body.

**Fields**

| Field | Type | Description |
|---|---|---|
| name | text | Name of the office |
| city | text | City |

**Relations**

| Relation | Label (en / de) | To | Cardinality | Kind | Description |
|---|---|---|---|---|---|
| `implements` | implements / setzt um | Catalogue entry | 0..* → 0..* | stated | Processes it runs, by catalogue variant |

## Reference model
- id: `reference`
- group: federal
- de: Referenzmodell

The target process and settings the oversight body defines for a catalogue variant.

**Fields**

| Field | Type | Description |
|---|---|---|
| name | text | Name |
| process | process | The reference process |
| settings | settings | The reference settings |

**Relations**

| Relation | Label (en / de) | To | Cardinality | Kind | Description |
|---|---|---|---|---|---|
| `defines` | defines / legt fest | Catalogue entry | 0..1 → 1 | stated | The variant it is the reference for |
