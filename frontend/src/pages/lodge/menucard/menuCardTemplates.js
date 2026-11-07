// Template catalogue.
// Each design is a different layout (header structure, ornaments, how a
// category and a dish are set), not a recolour: the structure lives in the
// markup + menuCard.css under `.mc-t-<id>`, and `palettes` only supplies the
// colour variations offered in the customiser.
const P = (name, bg, paper, ink, muted, accent, accent2, line, on) => ({
  name,
  vars: {
    '--bg': bg, '--paper': paper, '--ink': ink, '--muted': muted,
    '--accent': accent, '--accent2': accent2, '--line': line, '--on': on,
  },
  swatch: [bg, accent, accent2],
});

export const TEMPLATES = [
  {
    id: 'gourmet', name: 'Restaurant Gourmet', blurb: 'Dark, photo-led with warm accents',
    palettes: [
      P('Charcoal Amber', '#16130F', '#211C16', '#F5EDE0', '#A39A8B', '#E9A23B', '#E9A23B', '#3A3229', '#16130F'),
      P('Charcoal Chilli', '#141214', '#201C1F', '#F6EEE9', '#A5979A', '#E4572E', '#E4572E', '#38313A', '#FFFFFF'),
      P('Charcoal Herb', '#11160F', '#1B2218', '#EEF3E6', '#97A38B', '#9CCB4A', '#9CCB4A', '#2E3928', '#11160F'),
    ],
  },
];

export const templateById = () => TEMPLATES[0];
