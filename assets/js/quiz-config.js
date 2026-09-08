// Découvre dynamiquement les quiz présents dans config/ : les fichiers doivent
// suivre la convention de nommage quiz-1.json, quiz-2.json, quiz-3.json, ... sans trou
// (un hébergement statique comme GitHub Pages ne permet pas de lister un dossier).
export async function loadQuizConfigs(basePath) {
  const ids = [];
  const configs = {};
  let n = 1;
  while (true) {
    const id = `quiz-${n}`;
    let res;
    try {
      res = await fetch(`${basePath}${id}.json`);
    } catch {
      break;
    }
    if (!res.ok) break;
    configs[id] = await res.json();
    ids.push(id);
    n++;
  }
  return { ids, configs };
}
