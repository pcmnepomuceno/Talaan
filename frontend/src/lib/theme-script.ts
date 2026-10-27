// Runs before first paint. Missing, invalid or unreadable value leaves no attribute = "system".
export const themeScript = `try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;
