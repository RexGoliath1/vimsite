/* Global type declarations for vimsite */

interface EditorAPI {
  newEntry: () => void;
  editEntry: (slug: string) => void;
  deleteEntry: (slug: string) => void;
  clearToken: () => void;
}

interface Window {
  __editor?: EditorAPI;
  __vizModules: Record<string, (el: HTMLElement) => void>;
}
