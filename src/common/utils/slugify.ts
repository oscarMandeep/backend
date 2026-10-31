/** "Node.js" -> "node-js", "C++" -> "c-plus-plus", "C#" -> "c-sharp". */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[+#]/g, (c) => (c === '+' ? 'plus' : 'sharp'))
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}
