document.documentElement.classList.add("js");

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const examples = {
  sarah: {
    person: "Sarah Miller",
    question: "What should I remember before I see Sarah tomorrow?",
    answer: [
      "Sarah started a new role this week.",
      "You're meeting Thursday evening.",
      "You said you'd send the quiet Italian restaurant you mentioned."
    ]
  },
  jake: {
    person: "Jake Thompson",
    question: "What did I promise Jake?",
    answer: [
      "You said you'd introduce Jake to Daniel Lewis.",
      "You planned to make the introduction after their conference."
    ]
  },
  rachel: {
    person: "Rachel Brooks",
    question: "What's coming up with Rachel?",
    answer: [
      "Rachel's birthday is next Tuesday.",
      "She mentioned wanting a relaxed dinner."
    ]
  }
};

function setMagicExample(tab, shouldFocus = false) {
  const demo = tab.closest("[data-magic]");
  const panel = demo?.querySelector(".answer-panel");
  const example = examples[tab.dataset.question];
  if (!demo || !panel || !example) return;

  demo.querySelectorAll("[role='tab']").forEach((item) => {
    const selected = item === tab;
    item.classList.toggle("is-active", selected);
    item.setAttribute("aria-selected", String(selected));
    item.tabIndex = selected ? 0 : -1;
  });

  const render = () => {
    panel.setAttribute("aria-labelledby", tab.id);
    panel.querySelector("[data-answer-person]").textContent = example.person;
    panel.querySelector("[data-answer-question]").textContent = example.question;
    panel.querySelector("[data-answer-copy]").innerHTML = example.answer
      .map((line) => `<p>${line}</p>`)
      .join("");
    panel.classList.remove("is-changing");
  };

  if (reducedMotion.matches) {
    render();
  } else {
    panel.classList.add("is-changing");
    window.setTimeout(render, 150);
  }

  if (shouldFocus) tab.focus();
}

document.querySelectorAll("[data-magic]").forEach((demo) => {
  const tabs = [...demo.querySelectorAll("[role='tab']")];

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => setMagicExample(tab));
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
      event.preventDefault();

      let nextIndex = index;
      if (event.key === "Home") nextIndex = 0;
      if (event.key === "End") nextIndex = tabs.length - 1;
      if (event.key === "ArrowDown" || event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
      if (event.key === "ArrowUp" || event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
      setMagicExample(tabs[nextIndex], true);
    });
  });
});

const header = document.querySelector("[data-header]");
const mobileHeader = window.matchMedia("(max-width: 600px)");
let previousScrollY = window.scrollY;
const updateHeader = () => {
  const currentScrollY = window.scrollY;
  header?.classList.toggle("is-scrolled", currentScrollY > 24);

  if (!header) return;
  if (!mobileHeader.matches || currentScrollY < 96) {
    header.classList.remove("is-hidden");
  } else if (currentScrollY > previousScrollY) {
    header.classList.add("is-hidden");
  } else if (currentScrollY < previousScrollY) {
    header.classList.remove("is-hidden");
  }

  previousScrollY = currentScrollY;
};
updateHeader();
window.addEventListener("scroll", updateHeader, { passive: true });
mobileHeader.addEventListener("change", updateHeader);

const revealElements = [...document.querySelectorAll("[data-reveal]")];
if (reducedMotion.matches || !("IntersectionObserver" in window)) {
  revealElements.forEach((element) => element.classList.add("is-visible"));
} else {
  const observer = new IntersectionObserver((entries, instance) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      instance.unobserve(entry.target);
    });
  }, { rootMargin: "0px 0px -8%", threshold: 0.08 });

  revealElements.forEach((element) => observer.observe(element));
}

const productDepth = document.querySelector("[data-product-depth]");
if (productDepth && !reducedMotion.matches) {
  let scheduled = false;
  const updateDepth = () => {
    const rect = productDepth.getBoundingClientRect();
    const progress = Math.max(-1, Math.min(1, (window.innerHeight - rect.top) / (window.innerHeight + rect.height) - 0.5));
    productDepth.style.transform = `translate3d(0, ${progress * -10}px, 0)`;
    scheduled = false;
  };

  window.addEventListener("scroll", () => {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(updateDepth);
  }, { passive: true });
  updateDepth();
}
