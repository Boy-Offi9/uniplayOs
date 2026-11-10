window.__UNIPLAYOS_ORIGIN__ = new URL('./', import.meta.url).origin;
await import(new URL('./embed.js', import.meta.url));
export default window.UniplayOS;
