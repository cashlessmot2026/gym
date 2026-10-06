// Actualiza public/nutrition-updates.json con las publicaciones más recientes de nutrición
// deportiva desde PubMed (API oficial E-utilities del NIH, gratuita y sin clave).
// Lo ejecuta GitHub Actions cada semana (.github/workflows/nutrition-updates.yml).
import { writeFileSync } from 'node:fs'

const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils'
const QUERIES = [
  // Posturas oficiales de la International Society of Sports Nutrition
  '"J Int Soc Sports Nutr"[Journal] AND ("position stand"[Title] OR "position statement"[Title])',
  // Consensos y guías de nutrición deportiva (ACSM, COI, etc.)
  '("Sports Nutritional Physiological Phenomena"[MeSH] OR "sports nutrition"[Title/Abstract]) AND (consensus[Title] OR guideline*[Title] OR "position stand"[Title] OR "position statement"[Title])',
  // Revisiones sistemáticas recientes sobre proteína, creatina, hidratación y suplementos en ejercicio
  '(protein[Title] OR creatine[Title] OR hydration[Title] OR caffeine[Title] OR supplement*[Title]) AND (exercise[Title/Abstract] OR athletes[Title/Abstract] OR "resistance training"[Title/Abstract]) AND (systematic review[pt] OR meta-analysis[pt])'
]

const get = async (url) => {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'IronYellowGym/1.0 (nutrition updates)' } })
      if (r.ok) return r.json()
    } catch { /* error de red: reintentar */ }
    await new Promise((res) => setTimeout(res, 2000 * (i + 1)))
  }
  throw new Error('PubMed no respondió: ' + url)
}

const items = []
const seen = new Set()
for (const term of QUERIES) {
  const s = await get(`${EUTILS}/esearch.fcgi?db=pubmed&retmode=json&sort=pub_date&retmax=8&datetype=pdat&reldate=1095&term=${encodeURIComponent(term)}`)
  const ids = s.esearchresult.idlist.filter((id) => !seen.has(id))
  ids.forEach((id) => seen.add(id))
  if (!ids.length) continue
  await new Promise((r) => setTimeout(r, 400)) // límite de la API: 3 peticiones/s sin clave
  const sum = await get(`${EUTILS}/esummary.fcgi?db=pubmed&retmode=json&id=${ids.join(',')}`)
  for (const id of ids) {
    const d = sum.result[id]
    if (!d?.title) continue
    items.push({
      title: d.title.replace(/\.$/, ''),
      source: d.fulljournalname || d.source,
      date: d.pubdate || d.sortpubdate?.slice(0, 10),
      sort: d.sortpubdate || '',
      url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`
    })
  }
  await new Promise((r) => setTimeout(r, 400))
}

items.sort((a, b) => b.sort.localeCompare(a.sort))
const out = { updated: new Date().toISOString(), source: 'PubMed (NIH E-utilities)', items: items.slice(0, 15).map(({ sort, ...x }) => x) }
writeFileSync(new URL('../public/nutrition-updates.json', import.meta.url), JSON.stringify(out, null, 2) + '\n')
console.log(`${out.items.length} publicaciones guardadas`)
