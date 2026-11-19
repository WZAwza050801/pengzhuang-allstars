let loaded = false;
export const practiceScreenLoaded = () => loaded;
export async function loadPracticeScreen() {
  const module = await import('./matchScreen');
  loaded = true;
  return { default: module.PracticeMatchScreen };
}
