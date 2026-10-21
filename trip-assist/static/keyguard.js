// Google マップより先にキー入力を受け取り、旅行アシストのパネル内の入力は Maps に渡さない
for (const type of ["keydown", "keypress", "keyup"]) {
  window.addEventListener(
    type,
    (e) => {
      const host = document.getElementById("tripassist-host");
      if (host && e.composedPath().includes(host)) e.stopImmediatePropagation();
    },
    true,
  );
}
