/* Типограф: короткие слова, сокращения (ст., п., ч., №) и тире не остаются в конце строки.
   Работает по текстовым узлам, не трогает script/style/textarea/input. */
(function () {
  var SKIP = /^(SCRIPT|STYLE|TEXTAREA|INPUT|CODE|PRE)$/;
  var NB = ' ';
  var re1 = /(?<![A-Za-zА-Яа-яЁё0-9])((?:[(«"„])?[A-Za-zА-Яа-яЁё]{1,3}[,;:)]*|ст\.|п\.|ч\.|пп\.|№)\s+(?=\S)/g;
  var re2 = /\s+([—–])/g;
  function fix(s) {
    var prev;
    do { prev = s; s = s.replace(re1, function (m, w) { return w + NB; }); } while (s !== prev);
    return s.replace(re2, NB + '$1');
  }
  function walk(root) {
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        var p = n.parentNode;
        if (!p || SKIP.test(p.nodeName) || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var list = [], n;
    while ((n = w.nextNode())) list.push(n);
    list.forEach(function (t) { var v = fix(t.nodeValue); if (v !== t.nodeValue) t.nodeValue = v; });
  }
  window.NDTypo = walk;
  function run() {
    walk(document.body);
    new MutationObserver(function (ms) {
      ms.forEach(function (m) { m.addedNodes.forEach(function (n) {
        if (n.nodeType === 1) walk(n); else if (n.nodeType === 3 && n.parentNode) walk(n.parentNode);
      }); });
    }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
})();
