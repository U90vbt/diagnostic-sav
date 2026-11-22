/* =========================================================================
   DIAG·SAV — générateur PDF minimal (aucune librairie, aucun appel externe)
   Texte uniquement, A4, polices standard Helvetica / Helvetica-Bold
   (présentes dans tous les lecteurs PDF), encodage WinAnsi (accents français).
   Chargé à la demande par app.js : window.DIAGSAV_PDF.create()
   ========================================================================= */
(() => {
  'use strict';

  const PAGE_W = 595.28, PAGE_H = 841.89, MARGIN = 50, FOOTER = 32;

  /* Largeurs AFM (1/1000 em) des caractères ASCII 32–126. */
  const W_REG = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
  const W_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];

  /* Caractères hors Latin-1 disponibles dans WinAnsi : code, largeur normale, largeur grasse. */
  const WIN = {
    '€': [0x80, 556, 556], '‚': [0x82, 222, 278], '„': [0x84, 333, 500], '…': [0x85, 1000, 1000],
    'Œ': [0x8C, 1000, 1000], '‘': [0x91, 222, 278], '’': [0x92, 222, 278], '“': [0x93, 333, 500],
    '”': [0x94, 333, 500], '•': [0x95, 350, 350], '–': [0x96, 556, 556], '—': [0x97, 1000, 1000],
    '™': [0x99, 1000, 1000], 'œ': [0x9C, 944, 944], 'Ÿ': [0x9F, 667, 667]
  };
  /* Remplacements des symboles absents de WinAnsi. */
  const SUBST = { '→': '->', '←': '<-', '↪': '->', '↺': '<-', '⇪': '^', '≤': '<=', '≥': '>=', '✓': 'x', '✔': 'x', '✕': 'x',
    '⚠': '!', '★': '*', '⌫': '<-', ' ': ' ', ' ': ' ', '‑': '-', '²': '²', 'Ω': 'Ohm', '≈': '~', '×': 'x' };

  /** Texte → [{ code, w }] en WinAnsi, avec largeur selon la graisse. */
  function encode(text, bold) {
    const out = [];
    for (const raw of String(text == null ? '' : text)) {
      const ch = SUBST[raw] !== undefined ? SUBST[raw] : raw;
      for (const c of ch) {
        const cp = c.codePointAt(0);
        if (cp >= 32 && cp <= 126) { out.push({ code: cp, w: (bold ? W_BOLD : W_REG)[cp - 32] }); continue; }
        if (WIN[c]) { out.push({ code: WIN[c][0], w: WIN[c][bold ? 2 : 1] }); continue; }
        if (cp === 0xA0) { out.push({ code: 32, w: 278 }); continue; }
        if (cp >= 0xA1 && cp <= 0xFF) {
          // lettre accentuée : même largeur que la lettre de base (vrai pour Helvetica)
          const base = c.normalize('NFD')[0];
          const b = base.codePointAt(0);
          const w = (b >= 32 && b <= 126 && base !== c) ? (bold ? W_BOLD : W_REG)[b - 32]
            : ({ 0xAB: 556, 0xBB: 556, 0xB0: 400, 0xB7: 278, 0xA9: 737, 0xAE: 737, 0xB2: 333, 0xB3: 333, 0xC6: 1000, 0xE6: 889, 0xDF: 611 }[cp] || 556);
          out.push({ code: cp, w });
          continue;
        }
        out.push({ code: 63, w: 556 }); // « ? » pour l'inconnu
      }
    }
    return out;
  }

  const widthOf = (text, size, bold) => encode(text, bold).reduce((s, g) => s + g.w, 0) * size / 1000;

  /** Chaîne PDF : ASCII imprimable tel quel, le reste en octal (fichier 100 % ASCII). */
  function pdfString(text, bold) {
    let s = '(';
    for (const g of encode(text, bold)) {
      if (g.code === 40 || g.code === 41 || g.code === 92) s += '\\' + String.fromCharCode(g.code);
      else if (g.code >= 32 && g.code <= 126) s += String.fromCharCode(g.code);
      else s += '\\' + g.code.toString(8).padStart(3, '0');
    }
    return s + ')';
  }

  /** Coupe un texte en lignes tenant dans maxWidth (points). */
  function wrap(text, size, bold, maxWidth) {
    const lines = [];
    for (const para of String(text == null ? '' : text).split('\n')) {
      let line = '';
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const test = line ? line + ' ' + word : word;
        if (widthOf(test, size, bold) <= maxWidth) { line = test; continue; }
        if (line) lines.push(line);
        // mot trop long : coupé au caractère
        let w = word;
        while (widthOf(w, size, bold) > maxWidth) {
          let i = w.length;
          while (i > 1 && widthOf(w.slice(0, i), size, bold) > maxWidth) i--;
          lines.push(w.slice(0, i)); w = w.slice(i);
        }
        line = w;
      }
      lines.push(line);
    }
    return lines;
  }

  const rgb = hex => {
    const n = parseInt(hex.replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => (v / 255).toFixed(3)).join(' ');
  };

  function create(opts = {}) {
    const pages = [];
    let ops = null, y = 0;
    const contentW = PAGE_W - 2 * MARGIN;

    const newPage = () => { ops = []; pages.push(ops); y = PAGE_H - MARGIN; };
    const ensure = h => { if (!ops || y - h < MARGIN + FOOTER) newPage(); };

    function textLine(str, x, yy, size, bold, color) {
      ops.push('BT /' + (bold ? 'F2' : 'F1') + ' ' + size + ' Tf ' + rgb(color || '#111111') + ' rg ' +
        x.toFixed(2) + ' ' + yy.toFixed(2) + ' Td ' + pdfString(str, bold) + ' Tj ET');
    }

    const doc = {
      /** Paragraphe avec retour à la ligne automatique. */
      text(str, o = {}) {
        const size = o.size || 10.5, bold = !!o.bold, indent = o.indent || 0, lh = size * (o.leading || 1.35);
        const lines = wrap(str, size, bold, contentW - indent - (o.hang || 0));
        lines.forEach((l, i) => {
          ensure(lh);
          y -= lh;
          textLine(l, MARGIN + indent + (i ? (o.hang || 0) : 0), y + size * 0.25, size, bold, o.color);
        });
        if (o.after) y -= o.after;
        return doc;
      },
      /** Élément de liste : puce ou numéro, texte en retrait. */
      item(marker, str, o = {}) {
        const size = o.size || 10.5, lh = size * 1.35, indent = (o.indent || 0) + 18;
        const lines = wrap(str, size, !!o.bold, contentW - indent);
        lines.forEach((l, i) => {
          ensure(lh);
          y -= lh;
          if (i === 0) textLine(marker, MARGIN + indent - 16, y + size * 0.25, size, !!o.markerBold, o.markerColor || o.color);
          textLine(l, MARGIN + indent, y + size * 0.25, size, !!o.bold, o.color);
        });
        y -= o.after != null ? o.after : 3;
        return doc;
      },
      /** Libellé : valeur sur une ligne (valeur renvoyée à la ligne si besoin). */
      row(label, value, o = {}) {
        const size = o.size || 10.5, lh = size * 1.35, col = o.col || 95;
        const lines = wrap(value, size, false, contentW - col);
        lines.forEach((l, i) => {
          ensure(lh);
          y -= lh;
          if (i === 0) textLine(label, MARGIN, y + size * 0.25, size, true, '#555555');
          textLine(l, MARGIN + col, y + size * 0.25, size, false, o.color);
        });
        return doc;
      },
      heading(str, o = {}) {
        const size = o.size || 13;
        ensure(size * 1.6 + 24);
        y -= o.before != null ? o.before : 14;
        doc.text(str, { size, bold: true, color: o.color || '#111111' });
        y -= 4;
        return doc;
      },
      /** Bandeau coloré (gravité). */
      band(str, color, o = {}) {
        const size = o.size || 11, hgt = size + 12;
        ensure(hgt + 6);
        y -= hgt + 4;
        ops.push(rgb(color) + ' rg ' + MARGIN + ' ' + y.toFixed(2) + ' ' + contentW.toFixed(2) + ' ' + hgt + ' re f');
        textLine(str, MARGIN + 10, y + 7, size, true, '#ffffff');
        y -= 6;
        return doc;
      },
      rule(color = '#cccccc') {
        ensure(10);
        y -= 6;
        ops.push(rgb(color) + ' RG 0.6 w ' + MARGIN + ' ' + y.toFixed(2) + ' m ' + (PAGE_W - MARGIN) + ' ' + y.toFixed(2) + ' l S');
        y -= 6;
        return doc;
      },
      space(n = 8) { y -= n; return doc; },

      /** Assemble le fichier et renvoie un Blob application/pdf. */
      toBlob() {
        if (!pages.length) newPage();
        const total = pages.length;
        pages.forEach((p, i) => {
          const foot = (opts.footer ? opts.footer + ' — ' : '') + 'page ' + (i + 1) + '/' + total;
          p.push('BT /F1 8 Tf ' + rgb('#888888') + ' rg ' + MARGIN + ' 26 Td ' + pdfString(foot) + ' Tj ET');
        });
        const objs = [];
        const add = body => { objs.push(body); return objs.length; };
        const catalog = add(null), pagesObj = add(null);
        const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
        const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
        const kids = [];
        for (const p of pages) {
          const stream = p.join('\n');
          const c = add('<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream');
          kids.push(add('<< /Type /Page /Parent ' + pagesObj + ' 0 R /MediaBox [0 0 ' + PAGE_W + ' ' + PAGE_H + '] ' +
            '/Resources << /Font << /F1 ' + f1 + ' 0 R /F2 ' + f2 + ' 0 R >> >> /Contents ' + c + ' 0 R >>'));
        }
        objs[catalog - 1] = '<< /Type /Catalog /Pages ' + pagesObj + ' 0 R >>';
        objs[pagesObj - 1] = '<< /Type /Pages /Kids [' + kids.map(k => k + ' 0 R').join(' ') + '] /Count ' + kids.length + ' >>';
        const info = add('<< /Title ' + pdfString(opts.title || 'Rapport') + ' /Producer (DIAG-SAV) /CreationDate (D:' +
          new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + ') >>');

        let out = '%PDF-1.4\n%âãÏÓ\n';
        // l'en-tête binaire est encodé en Latin-1 octet par octet (voir plus bas)
        const offsets = [];
        objs.forEach((body, i) => { offsets.push(out.length); out += (i + 1) + ' 0 obj\n' + body + '\nendobj\n'; });
        const xref = out.length;
        out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' +
          offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('') +
          'trailer\n<< /Size ' + (objs.length + 1) + ' /Root ' + catalog + ' 0 R /Info ' + info + ' 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
        // 1 caractère = 1 octet (tout est ASCII sauf les 4 octets de l'en-tête)
        const bytes = new Uint8Array(out.length);
        for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255;
        return new Blob([bytes], { type: 'application/pdf' });
      }
    };
    return doc;
  }

  window.DIAGSAV_PDF = { create, wrap, widthOf };
})();
