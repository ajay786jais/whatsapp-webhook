function normalizeText(text = '') {
  return text
    .toString()
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function parseIntent(rawText = '') {
  const normalizedText = normalizeText(rawText);

  if (!normalizedText) {
    return { type: 'unknown', rawText, normalizedText };
  }

  const [command, ...parts] = normalizedText.split(' ');

  if ((command === 'search' || command === 'find') && parts.length > 0) {
    return {
      type: 'search',
      command,
      keyword: parts.join(' '),
      rawText,
      normalizedText,
    };
  }

  if (command === 'price' && parts.length > 0) {
    return {
      type: 'price',
      query: parts.join(' '),
      rawText,
      normalizedText,
    };
  }

  if (command === 'order' && parts.length >= 2) {
    const quantityRaw = parts.at(-1);
    const sku = parts.slice(0, -1).join(' ').toUpperCase();
    const quantity = Number.parseInt(quantityRaw, 10);

    if (sku && Number.isInteger(quantity) && quantity > 0) {
      return {
        type: 'order',
        sku,
        quantity,
        rawText,
        normalizedText,
      };
    }
  }

  return { type: 'unknown', rawText, normalizedText };
}

module.exports = {
  normalizeText,
  parseIntent,
};
