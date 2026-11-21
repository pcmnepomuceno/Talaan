// SPIKE ONLY. One request on open. Shows the HTTP status and nothing else: the response body,
// headers and cookies are never read.
const result = document.getElementById("result");
fetch("https://talaan-phi.vercel.app/api/v1/me", { credentials: "include", redirect: "manual" }).then(
  (r) => {
    result.textContent = `${r.status} ${r.status === 200 ? "logged in" : "not logged in"}`;
  },
  () => {
    result.textContent = "network error";
  },
);
document.getElementById("origin").addEventListener("click", () => {
  document.getElementById("originText").textContent = location.origin;
});
