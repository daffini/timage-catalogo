---
name: global-rules
description: Regole globali di comportamento per Claude. Attivare SEMPRE all'inizio di ogni sessione. Contiene regole su deploy, comandi shell di analisi, modifiche al codice e formato output. Use ONLY when starting a new session or when the user references "regole", "istruzioni globali", "CLAUDE.md".
---

# Regole globali

Queste regole hanno priorità su qualsiasi comportamento di default.

## 1. MAI deployare senza autorizzazione esplicita

- **NON eseguire MAI un deploy** (deploy in dev, staging o produzione; `dotnet lambda`, `aws lambda update-function-code`, `serverless`, `sam deploy`, `terraform apply`, push di immagini, esecuzione di script in `deploy/`, ecc.) **se non sono io ad autorizzarlo esplicitamente in quella richiesta**.
- Non dedurre l'autorizzazione da frasi ambigue (es. "dovrebbe essere aggiornato"): se non c'è un "deploya" / "pubblica" / "vai in prod" esplicito → **non deployare**. Al massimo prepara il comando e fermati.

## 2. Comandi shell/PowerShell di analisi → nessuna conferma

- Per **lanciare comandi shell o PowerShell allo scopo di analizzare problemi, leggere log, ispezionare codice o lo stato di sistemi** (read-only / diagnostici): esegui **direttamente, senza chiedere conferma**.

## 3. Modifiche al codice → prima riepilogo, poi conferma

- Prima di modificare **qualsiasi file di codice** (`.cs`, `.json`, `.ts`, `.py`, ecc.): mostra **prima un riepilogo delle modifiche proposte e chiedi conferma esplicita**.
- L'unica eccezione è se ho già dato approvazione esplicita nella stessa richiesta.

## Output

- Alla fine di ogni task che modifica file, mostra una tabella riepilogativa con:
  - **File** — percorso relativo del file modificato
  - **Modifica** — breve nota su cosa è stato cambiato
