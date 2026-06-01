/* ============================================================
 * Migration jetable : corrige l'encodage UTF-8 dans
 *   Documents/NavXpressVFR/ourairports data/airports-msfs.jsonl
 *
 * Cause : `readString*` de node-simconnect décode les octets en
 * Latin-1 alors que MSFS envoie de l'UTF-8 → double encodage à
 * l'écriture du JSONL (« Pérols » → « PÃ©rols »).
 *
 * Ce script applique fixUtf8 à toutes les chaînes JSON, sauf si
 * le résultat n'est pas de l'UTF-8 valide (TextDecoder fatal=true)
 * — auquel cas la chaîne est laissée intacte (ASCII pur, déjà
 * correcte, etc.). Le fichier d'origine est sauvegardé en .bak.
 *
 * Usage :  node fix-airports-encoding.js
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const os = require('os');

const SRC = path.join(os.homedir(), 'Documents', 'NavXpressVFR', 'ourairports data', 'airports-msfs.jsonl');
const BAK = SRC + '.bak';
const TMP = SRC + '.tmp';

const dec = new TextDecoder('utf-8', { fatal: true });
function fixUtf8(s) {
  if (!s) return s;
  // Itère jusqu'à idempotence (≤ 4 passes) pour traiter les cas de
  // triple-encoding rencontrés sur certains noms MSFS (« EstÃÂ¢ncia »).
  let cur = s;
  for (let i = 0; i < 4; i++) {
    let next;
    try { next = dec.decode(Buffer.from(cur, 'latin1')); }
    catch (_) { return cur; }
    if (next === cur) return cur;
    cur = next;
  }
  return cur;
}

// Traverse récursivement et fixe toute string trouvée.
let strChanged = 0;
function fixDeep(v) {
  if (typeof v === 'string') {
    const f = fixUtf8(v);
    if (f !== v) strChanged++;
    return f;
  }
  if (Array.isArray(v)) return v.map(fixDeep);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) out[k] = fixDeep(v[k]);
    return out;
  }
  return v;
}

if (!fs.existsSync(SRC)) {
  console.error('Source absente :', SRC);
  process.exit(1);
}

// Backup : on conserve TOUJOURS le tout premier .bak (état brut de
// l'extraction). Si une passe ultérieure relance le script (correction
// itérative), on ne le réécrit pas mais on autorise quand même la passe.
if (fs.existsSync(BAK)) {
  console.log('Backup déjà présent (conservé tel quel) :', BAK);
} else {
  fs.copyFileSync(SRC, BAK);
  console.log('Backup créé :', BAK);
}

const raw = fs.readFileSync(SRC, 'utf-8');
const lines = raw.split('\n');
const out = fs.createWriteStream(TMP, { encoding: 'utf8' });

let lineNo = 0;
let lineOk = 0;
let lineSkipped = 0;
let lineErr = 0;

for (const line of lines) {
  if (!line) continue;
  lineNo++;
  try {
    const obj = JSON.parse(line);
    const fixed = fixDeep(obj);
    out.write(JSON.stringify(fixed) + '\n');
    lineOk++;
  } catch (e) {
    // ligne non-JSON → on la garde telle quelle (header ?)
    out.write(line + '\n');
    lineSkipped++;
  }
}

out.end(() => {
  fs.renameSync(TMP, SRC);
  console.log('──────────────────────────────────────────────');
  console.log(`Lignes lues       : ${lineNo}`);
  console.log(`Lignes JSON OK    : ${lineOk}`);
  console.log(`Lignes non-JSON   : ${lineSkipped}`);
  console.log(`Lignes en erreur  : ${lineErr}`);
  console.log(`Chaînes corrigées : ${strChanged}`);
  console.log(`\n→ Fichier corrigé : ${SRC}`);
  console.log(`→ Sauvegarde      : ${BAK}`);
});
