// Small progressive enhancements for the vigo landing page.
(function () {
  "use strict";

  // Copy-to-clipboard for install commands.
  document.querySelectorAll("[data-copy]").forEach(function (button) {
    button.addEventListener("click", function () {
      var text = button.getAttribute("data-copy") || "";
      var done = function () {
        var original = button.textContent;
        button.textContent = "Copied";
        button.classList.add("copied");
        window.setTimeout(function () {
          button.textContent = original;
          button.classList.remove("copied");
        }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () {});
      } else {
        var field = document.createElement("textarea");
        field.value = text;
        field.setAttribute("readonly", "");
        field.style.position = "absolute";
        field.style.left = "-9999px";
        document.body.appendChild(field);
        field.select();
        try {
          document.execCommand("copy");
          done();
        } catch (error) {
          /* clipboard unavailable — the command is still visible on screen */
        }
        document.body.removeChild(field);
      }
    });
  });

  // Reveal sections as they scroll into view.
  var targets = Array.prototype.slice.call(document.querySelectorAll("section, .hero, footer"));
  if (!("IntersectionObserver" in window)) {
    targets.forEach(function (node) {
      node.classList.add("reveal", "in");
    });
    return;
  }
  var observer = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          observer.unobserve(entry.target);
        }
      });
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.05 }
  );
  targets.forEach(function (node) {
    node.classList.add("reveal");
    observer.observe(node);
  });
})();
