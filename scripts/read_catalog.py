"""Script per estrarre dati dal catalog.dat SQLite e generare JSON."""
import sqlite3
import json
import sys
import os

DB_PATH = r"C:\Progetti\Timage\3D\x CT PACK - PROVA\RIC_M.VRTX.CLSR.000012_REV 1.3_250929\RIC_M.VRTX.CLSR.000012_REV 1.3_250929\Data\M.VRTX.CLSR.000012\catalog.dat"
OUTPUT_DIR = r"C:\Progetti\Timage\timage-catalog\data\models\M.VRTX.CLSR.000012"

def try_open_db(path):
    """Prova ad aprire il db, prima senza password poi con pysqlcipher."""
    # Tentativo 1: senza password (potrebbe funzionare se non e encrypted a livello file)
    try:
        conn = sqlite3.connect(path)
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = cursor.fetchall()
        if tables:
            print(f"DB aperto senza password. Tabelle: {[t[0] for t in tables]}")
            return conn
    except Exception as e:
        print(f"Senza password fallito: {e}")

    print("Il database richiede una password SQLite Encryption Extension.")
    print("Prova: pip install pysqlcipher3")
    return None

def extract_data(conn):
    cursor = conn.cursor()

    # Lista tabelle
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = [t[0] for t in cursor.fetchall()]
    print(f"\nTabelle trovate: {tables}")

    # Schema di ogni tabella
    for table in tables:
        cursor.execute(f"PRAGMA table_info({table})")
        cols = cursor.fetchall()
        print(f"\n--- {table} ---")
        print(f"Colonne: {[c[1] for c in cols]}")
        cursor.execute(f"SELECT COUNT(*) FROM {table}")
        count = cursor.fetchone()[0]
        print(f"Righe: {count}")
        cursor.execute(f"SELECT * FROM {table} LIMIT 3")
        rows = cursor.fetchall()
        for row in rows:
            print(f"  {row}")

    return tables

def export_json(conn):
    cursor = conn.cursor()

    # Matricola
    cursor.execute("SELECT * FROM matricola LIMIT 1")
    matricola_cols = [d[0] for d in cursor.description]
    matricola_row = cursor.fetchone()
    print(f"\nMatricola cols: {matricola_cols}")
    print(f"Matricola data: {matricola_row}")

    # Anagrafica (parti)
    cursor.execute("SELECT * FROM anagrafica")
    parts_cols = [d[0] for d in cursor.description]
    parts_rows = cursor.fetchall()
    print(f"\nAnagrafica: {len(parts_rows)} parti, colonne: {parts_cols}")

    # Gruppi
    cursor.execute("SELECT * FROM indice_gruppi")
    groups_cols = [d[0] for d in cursor.description]
    groups_rows = cursor.fetchall()
    print(f"Gruppi: {len(groups_rows)} gruppi, colonne: {groups_cols}")

    # Sezioni
    cursor.execute("SELECT * FROM indice_sezioni")
    sections_cols = [d[0] for d in cursor.description]
    sections_rows = cursor.fetchall()
    print(f"Sezioni: {len(sections_rows)} sezioni, colonne: {sections_cols}")

    # Traduzioni
    try:
        cursor.execute("SELECT * FROM traduzioni")
        trans_cols = [d[0] for d in cursor.description]
        trans_rows = cursor.fetchall()
        print(f"Traduzioni: {len(trans_rows)} voci, colonne: {trans_cols}")
    except:
        trans_rows = []
        trans_cols = []

    # Impostazioni
    try:
        cursor.execute("SELECT * FROM impostazioni")
        settings_cols = [d[0] for d in cursor.description]
        settings_rows = cursor.fetchall()
        print(f"Impostazioni: {len(settings_rows)} voci")
        for row in settings_rows:
            print(f"  {row}")
    except:
        pass

    # --- Genera JSON ---
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # parts.json
    parts = []
    for row in parts_rows:
        part = dict(zip(parts_cols, row))
        parts.append(part)

    with open(os.path.join(OUTPUT_DIR, "parts_raw.json"), "w", encoding="utf-8") as f:
        json.dump(parts, f, indent=2, ensure_ascii=False)
    print(f"\nScritto parts_raw.json ({len(parts)} parti)")

    # groups_raw.json
    groups = []
    for row in groups_rows:
        group = dict(zip(groups_cols, row))
        groups.append(group)

    with open(os.path.join(OUTPUT_DIR, "groups_raw.json"), "w", encoding="utf-8") as f:
        json.dump(groups, f, indent=2, ensure_ascii=False)
    print(f"Scritto groups_raw.json ({len(groups)} gruppi)")

    # sections_raw.json
    sections = []
    for row in sections_rows:
        section = dict(zip(sections_cols, row))
        sections.append(section)

    with open(os.path.join(OUTPUT_DIR, "sections_raw.json"), "w", encoding="utf-8") as f:
        json.dump(sections, f, indent=2, ensure_ascii=False)
    print(f"Scritto sections_raw.json ({len(sections)} sezioni)")

    # translations_raw.json
    if trans_rows:
        translations = []
        for row in trans_rows:
            t = dict(zip(trans_cols, row))
            translations.append(t)
        with open(os.path.join(OUTPUT_DIR, "translations_raw.json"), "w", encoding="utf-8") as f:
            json.dump(translations, f, indent=2, ensure_ascii=False)
        print(f"Scritto translations_raw.json ({len(translations)} voci)")

if __name__ == "__main__":
    conn = try_open_db(DB_PATH)
    if conn:
        extract_data(conn)
        export_json(conn)
        conn.close()
        print("\nEstrazione completata!")
    else:
        print("\nImpossibile aprire il database. Serve pysqlcipher3 o sqlcipher.")
        sys.exit(1)
