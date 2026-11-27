/* =========================================================================
   Assistant AV — export du dossier avant-vente (chargé à la demande)
   - xlsx(dossier) : classeur Excel (.xlsx) écrit à la main, sans librairie
     (archive ZIP non compressée + feuilles SpreadsheetML)
   - pdf(dossier, PDF) : dossier PDF avec le générateur maison (pdf.js)
   Aucune donnée ne quitte le navigateur.
   ========================================================================= */
(() => {
  'use strict';

  /* ---------------- ZIP « stocké » (sans compression) ---------------- */
  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  const crc32 = bytes => { let c = 0xFFFFFFFF; for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function zip(files) {
    const enc = new TextEncoder();
    const parts = [], central = [];
    let offset = 0;
    const u16 = v => [v & 255, (v >>> 8) & 255];
    const u32 = v => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
    for (const f of files) {
      const name = enc.encode(f.name), data = enc.encode(f.content), crc = crc32(data);
      const head = [...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)];
      parts.push(new Uint8Array(head), name, data);
      central.push([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)], name);
      offset += head.length + name.length + data.length;
    }
    let size = 0;
    const cen = [];
    for (let i = 0; i < central.length; i += 2) { const h = new Uint8Array(central[i]); cen.push(h, central[i + 1]); size += h.length + central[i + 1].length; }
    const end = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(size), ...u32(offset), ...u16(0)]);
    return new Blob([...parts, ...cen, end], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  /* ---------------- Classeur .xlsx ---------------- */
  const x = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  const colName = i => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  function sheetXml(rows, widths) {
    const cols = widths && widths.length ? '<cols>' + widths.map((w, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>').join('') + '</cols>' : '';
    const body = rows.map((row, r) => '<row r="' + (r + 1) + '">' + row.map((v, c) => {
      const ref = colName(c) + (r + 1), st = r === 0 ? ' s="1"' : ' s="2"';
      if (typeof v === 'number' && isFinite(v)) return '<c r="' + ref + '"' + st + '><v>' + v + '</v></c>';
      if (v == null || v === '') return '';
      return '<c r="' + ref + '" t="inlineStr"' + st + '><is><t xml:space="preserve">' + x(v) + '</t></is></c>';
    }).join('') + '</row>').join('');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' + cols + '<sheetData>' + body + '</sheetData></worksheet>';
  }
  function workbook(sheets) {
    const files = [];
    files.push({ name: '[Content_Types].xml', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      sheets.map((_, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') + '</Types>' });
    files.push({ name: '_rels/.rels', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' });
    files.push({ name: 'xl/workbook.xml', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      sheets.map((s, i) => '<sheet name="' + x(s.name.slice(0, 31)) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets></workbook>' });
    files.push({ name: 'xl/_rels/workbook.xml.rels', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map((_, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') +
      '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' });
    files.push({ name: 'xl/styles.xml', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE9EDF2"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="3"><xf/><xf fontId="1" fillId="2" applyFont="1" applyFill="1"/><xf applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs></styleSheet>' });
    sheets.forEach((s, i) => files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', content: sheetXml(s.rows, s.widths) }));
    return zip(files);
  }

  function xlsx(d) {
    const sheets = [
      { name: 'Besoin', widths: [44, 60], rows: [['Question', 'Réponse'], ...d.besoin,
        [], ['Niveau', d.niveau], ['Date', d.date], ['Avertissement', d.avertissement]] },
      { name: 'Nomenclature', widths: [30, 6, 12, 32, 20, 30, 34, 11, 30, 50], rows: [['Bloc', 'Qté', 'Marque', 'Modèle / libellé', 'Référence', 'Type', 'Source', 'Statut', 'Inclus', 'Justification'],
        ...d.nomenclature.map(n => [n.bloc, n.qte || '', n.marque, n.modele, n.ref, n.type, n.source, n.statut, n.inclus, n.pourquoi])] },
      { name: 'Dimensionnement', widths: [40, 16, 11, 44], rows: [['Calcul', 'Valeur', 'Statut', 'Repère'], ...d.calculs] },
      { name: 'Liaisons', widths: [30, 14, 30, 18, 24, 12, 12, 11, 34], rows: [['De', 'Port', 'Vers', 'Port', 'Liaison', 'Longueur (m)', 'Maximum (m)', 'Contrôle', 'Remarque'],
        ...d.liaisons.map(l => [l.de, l.portDe, l.vers, l.portVers, l.type, l.longueur, l.max, l.controle, l.note])] },
      { name: 'Baie', widths: [44, 6, 10], rows: [['Équipement', 'Qté', 'Remarque'], ...d.baie] },
      { name: 'Points à valider', widths: [12, 90, 34], rows: [['Gravité', 'Point', 'Source'], ...d.points] }
    ];
    return workbook(sheets);
  }

  /* ---------------- Dossier PDF ---------------- */
  function pdf(d, PDF) {
    const doc = PDF.create({ title: d.titre + ' — ' + d.niveau, footer: 'Assistant AV — dossier avant-vente du ' + d.date });
    doc.text('Dossier avant-vente', { size: 20, bold: true, after: 2 });
    doc.text(d.titre + ' · niveau ' + d.niveau, { size: 12, color: '#555555', after: 6 });
    if (d.avertissement) doc.text(d.avertissement, { size: 9.5, color: '#8a5a12', after: 4 });
    doc.heading('Besoin exprimé');
    d.besoin.forEach(([q, a]) => doc.row(q, a, { col: 170, size: 9.5 }));
    if (d.calculs.length) {
      doc.heading('Dimensionnement');
      doc.table([{ label: 'Calcul', w: .42 }, { label: 'Valeur', w: .14 }, { label: 'Statut', w: .12 }, { label: 'Repère', w: .32 }], d.calculs);
    }
    doc.heading('Nomenclature');
    doc.table([{ label: 'Bloc', w: .2 }, { label: 'Qté', w: .06 }, { label: 'Matériel', w: .3 }, { label: 'Type / inclus', w: .22 }, { label: 'Source', w: .22 }],
      d.nomenclature.map(n => [n.bloc, n.qte || '—', (n.marque ? n.marque + ' ' : '') + n.modele + (n.ref ? ' (' + n.ref + ')' : '') + (n.statut ? ' · ' + n.statut : ''), n.inclus || n.type, n.source]));
    if (d.baie.length) {
      doc.heading('Contenu de la baie');
      doc.table([{ label: 'Équipement', w: .7 }, { label: 'Qté', w: .1 }, { label: 'Remarque', w: .2 }], d.baie);
      doc.text('Hauteur en baie (U) non indiquée dans les catalogues : à relever sur les notices.', { size: 8.5, color: '#666666' });
    }
    if (d.synoptique) {
      doc.page();
      doc.heading('Synoptique de câblage', { before: 0 });
      doc.figure(d.synoptique);
    }
    if (d.liaisons.length) {
      doc.heading('Liste des liaisons');
      doc.table([{ label: 'De', w: .24 }, { label: 'Vers', w: .24 }, { label: 'Liaison', w: .2 }, { label: 'Long.', w: .09 }, { label: 'Max', w: .09 }, { label: 'Contrôle', w: .14 }],
        d.liaisons.map(l => [l.de + (l.portDe ? ' [' + l.portDe + ']' : ''), l.vers + (l.portVers ? ' [' + l.portVers + ']' : ''), l.type + (l.note ? ' — ' + l.note : ''),
          l.longueur == null ? '—' : l.longueur + ' m', l.max == null ? '—' : l.max + ' m', l.controle || '—']),
        { colors: (row, i) => i === 5 && row[5] === 'Trop long' ? '#c23b33' : null });
      doc.text('Longueurs estimées à partir des réponses : à métrer sur place.', { size: 8.5, color: '#666666' });
    }
    if (d.points.length) {
      doc.heading('Points à valider');
      doc.table([{ label: 'Gravité', w: .14 }, { label: 'Point', w: .62 }, { label: 'Source', w: .24 }], d.points,
        { colors: (row, i) => i === 0 && row[0] === 'Bloquant' ? '#c23b33' : (i === 0 && row[0] === 'À vérifier' ? '#b8741a' : null) });
    }
    return doc.toBlob();
  }

  window.DIAGSAV_RECO_EXPORT = { xlsx, pdf, zip, workbook };
})();
