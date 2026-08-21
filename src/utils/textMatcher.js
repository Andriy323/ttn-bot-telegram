/**
 * Відстань Левенштейна для виявлення оддруківок
 */
export function getLevenshteinDistance(a, b) {
  if (!a || !b) return (a || b || '').length;
  const tmp = [];
  for (let i = 0; i <= b.length; i++) tmp[i] = [i];
  for (let j = 0; j <= a.length; j++) tmp[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      tmp[i][j] = b[i - 1] === a[j - 1]
        ? tmp[i - 1][j - 1]
        : Math.min(tmp[i - 1][j - 1] + 1, tmp[i][j - 1] + 1, tmp[i - 1][j] + 1);
    }
  }
  return tmp[b.length][a.length];
}

/**
 * Нормалізація типових закінчень українських слів для стемінгу
 */
export function normalizeUkrainianWord(w) {
  if (!w) return '';
  return w.toLowerCase().replace(/(ому|ого|ова|ами|ем|ом|ий|ій|ів|а|е|о|и|у|я|і|ь)$/g, '');
}

/**
 * Розумний пошук: розбиває ключові слова по комі і перевіряє кожне окремо + враховує оддруківки та відмінки
 */
export function fuzzyMatch(dbField, searchKey) {
  if (!dbField || !searchKey) return false;
  const search = searchKey.toLowerCase().trim();
  const keywords = dbField.toLowerCase().split(',').map(k => k.trim());

  return keywords.some(k => {
    // 1. Пряме входження
    if (k.includes(search) || search.includes(k)) return true;

    // 2. Порівняння за основою слова (відмінювання/закінчення)
    const stemK = normalizeUkrainianWord(k);
    const stemSearch = normalizeUkrainianWord(search);
    if (stemK.length >= 3 && stemK === stemSearch) return true;

    // 3. Пошук оддруківок через відстань Левенштейна
    const dist = getLevenshteinDistance(k, search);
    const maxAllowed = k.length <= 4 ? 1 : 2;
    return dist <= maxAllowed;
  });
}
