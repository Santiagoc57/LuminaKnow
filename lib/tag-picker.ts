type PickerTag = { id: string; name: string; level: "primary" | "secondary" | "free"; active?: boolean };

export function matchingCatalogTags<T extends PickerTag>(tags: T[], selectedIds: string[], query: string): T[] {
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es").trim();
  const needle = normalize(query);
  return tags.filter((tag) => tag.active !== false && !selectedIds.includes(tag.id) && normalize(tag.name).includes(needle));
}

export function canSelectCatalogTag(tags: PickerTag[], selectedIds: string[], tagId: string) {
  const tag = tags.find((item) => item.id === tagId && item.active !== false);
  if (!tag) return false;
  if (selectedIds.includes(tagId)) return true;
  const count = tags.filter((item) => selectedIds.includes(item.id) && item.level === tag.level).length;
  return count < (tag.level === "primary" ? 3 : tag.level === "free" ? 12 : 2);
}
