// Launch offer bar: click the code to copy it.
document.querySelectorAll(".pb-code").forEach(b => b.addEventListener("click", () => {
  const t = b.dataset.code;
  (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => { b.classList.add("copied"); setTimeout(() => b.classList.remove("copied"), 1600); }).catch(() => {});
}));
