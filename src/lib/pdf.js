import { jsPDF } from 'jspdf'
import { autoTable } from 'jspdf-autotable'

const YELLOW = [255, 214, 10]
const BLACK = [10, 10, 10]
const clean = (s) => s.replace(/\*\*|__|`|_/g, '').replace(/[^\x20-\x7EáéíóúÁÉÍÓÚñÑüÜ¿¡°·–—…•%$€\n]/g, '').trim()

/** Convierte el texto Markdown del nutricionista en un PDF con la marca del gym. */
export function nutritionPdf({ title = 'Plan de nutrición', member = {}, metrics = {}, markdown = '' }) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const M = 40
  let y = 0

  const header = () => {
    doc.setFillColor(...BLACK); doc.rect(0, 0, W, 70, 'F')
    doc.setFillColor(...YELLOW); doc.rect(0, 70, W, 4, 'F')
    doc.setTextColor(...YELLOW); doc.setFont('helvetica', 'bold'); doc.setFontSize(22)
    doc.text('IRONYELLOW GYM', M, 40)
    doc.setFontSize(10); doc.setTextColor(255, 255, 255)
    doc.text(clean(title), M, 58)
    doc.text(new Date().toLocaleDateString('es'), W - M, 58, { align: 'right' })
    y = 96
  }
  const ensure = (h) => { if (y + h > H - 40) { doc.addPage(); header() } }
  header()

  doc.setTextColor(...BLACK); doc.setFontSize(11); doc.setFont('helvetica', 'bold')
  doc.text(clean(member.full_name || ''), M, y)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
  const info = [
    metrics.weight && `Peso ${metrics.weight} kg`, metrics.height && `Estatura ${metrics.height} cm`,
    metrics.bmi && `IMC ${metrics.bmi}`, metrics.body_fat && `Grasa ${metrics.body_fat}%`,
    metrics.target_kcal && `Objetivo ${metrics.target_kcal} kcal`
  ].filter(Boolean).join('  ·  ')
  if (info) { y += 14; doc.text(info, M, y) }
  y += 20

  const lines = markdown.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const line = raw.trim()
    if (!line) { y += 6; continue }
    if (line.startsWith('|')) {
      const rows = []
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        const cells = lines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => clean(c))
        if (!cells.every((c) => /^:?-+:?$/.test(c))) rows.push(cells)
        i++
      }
      i--
      if (rows.length) {
        autoTable(doc, {
          startY: y, head: [rows[0]], body: rows.slice(1), margin: { left: M, right: M },
          styles: { fontSize: 8.5, cellPadding: 4 },
          headStyles: { fillColor: BLACK, textColor: YELLOW },
          alternateRowStyles: { fillColor: [255, 249, 219] },
          didDrawPage: () => {}
        })
        y = doc.lastAutoTable.finalY + 12
      }
      continue
    }
    if (/^#{1,3}\s/.test(line)) {
      ensure(30)
      doc.setFillColor(...YELLOW); doc.rect(M, y - 10, 4, 14, 'F')
      doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(...BLACK)
      doc.text(clean(line.replace(/^#+\s/, '')), M + 10, y + 1)
      y += 20
      continue
    }
    const bullet = /^[-*•]\s/.test(line)
    const quote = line.startsWith('>')
    const text = clean(line.replace(/^[-*•>]\s?/, ''))
    doc.setFont('helvetica', quote ? 'italic' : 'normal'); doc.setFontSize(10); doc.setTextColor(40, 40, 40)
    const wrapped = doc.splitTextToSize(text, W - M * 2 - (bullet ? 14 : 0))
    ensure(wrapped.length * 13)
    if (bullet) { doc.setFillColor(...YELLOW); doc.circle(M + 4, y - 3, 2.5, 'F') }
    doc.text(wrapped, M + (bullet ? 14 : 0), y)
    y += wrapped.length * 13 + 2
  }

  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p); doc.setFontSize(8); doc.setTextColor(140)
    doc.text(`IronYellow Gym · Página ${p}/${pages} · Este plan es orientativo, no sustituye la consulta médica.`, W / 2, H - 20, { align: 'center' })
  }
  doc.save(`${clean(title).replace(/\s+/g, '_')}_${(member.full_name || 'cliente').replace(/\s+/g, '_')}.pdf`)
}
