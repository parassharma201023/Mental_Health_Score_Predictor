(() => {
  "use strict";

  // ---------------------------------------------------------
  // API (unchanged)
  // ---------------------------------------------------------
  const API_BASE = "https://mansik-santulan-score.onrender.com";
  const REQUEST_TIMEOUT_MS = 90000; // free Render servers can take a while to wake up

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const form = document.getElementById("predict-form");
  const submitBtn = document.getElementById("submit-btn");
  const resetBtn = document.getElementById("reset-btn");
  const errorRetryBtn = document.getElementById("error-retry-btn");

  const readout = document.getElementById("readout");
  const stateIdle = document.getElementById("state-idle");
  const stateLoading = document.getElementById("state-loading");
  const stateResult = document.getElementById("state-result");
  const stateError = document.getElementById("state-error");

  const scoreNumberEl = document.getElementById("score-number");
  const scoreSubEl = document.getElementById("score-sub");
  const scoreBandEl = document.getElementById("score-band");
  const scoreContextEl = document.getElementById("score-context");
  const scaleMarker = document.getElementById("scale-marker");
  const loadingCopyEl = document.getElementById("loading-copy");
  const errorLabelEl = document.getElementById("error-label");
  const errorCopyEl = document.getElementById("error-copy");

  // ---------------------------------------------------------
  // Live day rings: each ring = hours / 24
  // ---------------------------------------------------------
  const arcs = document.querySelectorAll(".ring-arc");

  arcs.forEach((arc) => {
    const r = parseFloat(arc.getAttribute("r"));
    const c = 2 * Math.PI * r;
    arc.dataset.circ = String(c);
    arc.style.strokeDasharray = String(c);
    arc.style.strokeDashoffset = String(c);
    arc.style.opacity = "0";
  });

  function formatHours(v) {
    return Number.isFinite(v) ? `${Math.round(v * 10) / 10} h` : "–";
  }

  function updateRings() {
    arcs.forEach((arc) => {
      const input = document.getElementById(arc.dataset.source);
      const raw = parseFloat(input.value);
      const hours = Number.isFinite(raw) ? Math.max(0, Math.min(24, raw)) : 0;
      const c = parseFloat(arc.dataset.circ);
      arc.style.strokeDashoffset = String(c * (1 - hours / 24));
      arc.style.opacity = hours > 0 ? "1" : "0";

      const readoutEl = document.querySelector(`[data-readout="${arc.dataset.source}"]`);
      if (readoutEl) readoutEl.textContent = formatHours(Number.isFinite(raw) ? raw : NaN);
    });
  }

  // ---------------------------------------------------------
  // Sliders <-> number inputs
  // ---------------------------------------------------------
  function paintSlider(slider) {
    const min = parseFloat(slider.min) || 0;
    const max = parseFloat(slider.max) || 100;
    const pct = ((parseFloat(slider.value) - min) / (max - min)) * 100;
    slider.style.setProperty("--p", `${Math.max(0, Math.min(100, pct))}%`);
  }

  document.querySelectorAll(".slider").forEach((slider) => {
    const numberInput = document.getElementById(slider.dataset.sync);
    paintSlider(slider);

    slider.addEventListener("input", () => {
      numberInput.value = slider.value;
      paintSlider(slider);
      numberInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    numberInput.addEventListener("input", () => {
      const v = parseFloat(numberInput.value);
      slider.value = Number.isFinite(v) ? Math.min(v, parseFloat(slider.max)) : 0;
      paintSlider(slider);
    });
  });

  // update rings whenever any ring-linked field changes
  arcs.forEach((arc) => {
    document.getElementById(arc.dataset.source).addEventListener("input", updateRings);
  });
  updateRings();

  // ---------------------------------------------------------
  // Segmented choices (gender, academic level, purpose, stress)
  // ---------------------------------------------------------
  document.querySelectorAll(".seg").forEach((group) => {
    const hidden = document.getElementById(group.dataset.target);
    const buttons = group.querySelectorAll(".seg-btn");

    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        buttons.forEach((b) => b.setAttribute("aria-checked", "false"));
        btn.setAttribute("aria-checked", "true");
        hidden.value = btn.dataset.value;
        clearFieldError(hidden);
      });
    });
  });

  // ---------------------------------------------------------
  // Field-level error helpers
  // ---------------------------------------------------------
  function fieldWrapper(input) {
    return input.closest(".field");
  }

  function setFieldError(input, message) {
    const wrap = fieldWrapper(input);
    if (!wrap) return;
    wrap.classList.add("field-error");
    const msgEl = wrap.querySelector(".error-msg");
    if (msgEl) msgEl.textContent = message;
  }

  function clearFieldError(input) {
    const wrap = fieldWrapper(input);
    if (!wrap) return;
    wrap.classList.remove("field-error");
    const msgEl = wrap.querySelector(".error-msg");
    if (msgEl) msgEl.textContent = "";
  }

  function clearAllErrors() {
    form.querySelectorAll(".field").forEach((f) => f.classList.remove("field-error"));
    form.querySelectorAll(".error-msg").forEach((m) => (m.textContent = ""));
  }

  function focusField(input) {
    const wrap = fieldWrapper(input);
    if (!wrap) return;
    wrap.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "center" });
    const target = input.type === "hidden" ? wrap.querySelector(".seg-btn") : input;
    target?.focus?.({ preventScroll: true });
  }

  // ---------------------------------------------------------
  // Client-side validation mirroring the StudentData model (unchanged)
  // ---------------------------------------------------------
  function validate(payload) {
    const errors = [];

    const numericChecks = [
      ["age", 10, 100],
      ["avg_daily_usage_hours", 0, 24],
      ["daily_unlocks", 0, Infinity],
      ["study_hours", 0, 24],
      ["physical_activity_hours", 0, 24],
      ["sleep_hours_per_night", 0, 24],
    ];

    numericChecks.forEach(([key, min, max]) => {
      const input = document.getElementById(key);
      const val = payload[key];
      if (val === "" || val === null || Number.isNaN(val)) {
        errors.push([input, "Please fill this in."]);
      } else if (val < min || val > max) {
        errors.push([input, `Enter a number between ${min} and ${max === Infinity ? "0 or more" : max}.`]);
      }
    });

    [
      ["gender", "Choose one."],
      ["country", "Please fill this in."],
      ["academic_level", "Choose one."],
      ["most_used_platform", "Choose one."],
      ["purpose_of_use", "Choose one."],
    ].forEach(([key, msg]) => {
      const input = document.getElementById(key);
      if (!payload[key] || String(payload[key]).trim() === "") {
        errors.push([input, msg]);
      }
    });

    if (!payload.stress_level) {
      errors.push([document.getElementById("stress_level"), "Choose a stress level."]);
    }

    return errors;
  }

  // ---------------------------------------------------------
  // Gather form data into the exact StudentData shape (unchanged)
  // ---------------------------------------------------------
  function collectPayload() {
    const fd = new FormData(form);
    return {
      age: fd.get("age") === "" ? NaN : parseInt(fd.get("age"), 10),
      gender: fd.get("gender") || "",
      country: (fd.get("country") || "").trim(),
      academic_level: fd.get("academic_level") || "",
      most_used_platform: fd.get("most_used_platform") || "",
      purpose_of_use: fd.get("purpose_of_use") || "",
      avg_daily_usage_hours: fd.get("avg_daily_usage_hours") === "" ? NaN : parseFloat(fd.get("avg_daily_usage_hours")),
      daily_unlocks: fd.get("daily_unlocks") === "" ? NaN : parseInt(fd.get("daily_unlocks"), 10),
      study_hours: fd.get("study_hours") === "" ? NaN : parseFloat(fd.get("study_hours")),
      physical_activity_hours: fd.get("physical_activity_hours") === "" ? NaN : parseFloat(fd.get("physical_activity_hours")),
      sleep_hours_per_night: fd.get("sleep_hours_per_night") === "" ? NaN : parseFloat(fd.get("sleep_hours_per_night")),
      stress_level: fd.get("stress_level") || "",
    };
  }

  // ---------------------------------------------------------
  // UI state switching
  // ---------------------------------------------------------
  function showState(name) {
    [stateIdle, stateLoading, stateResult, stateError].forEach((el) => (el.hidden = true));
    ({ idle: stateIdle, loading: stateLoading, result: stateResult, error: stateError }[name]).hidden = false;
    readout.classList.toggle("is-loading", name === "loading");
  }

  function setSubmitting(isSubmitting) {
    submitBtn.disabled = isSubmitting;
    submitBtn.classList.toggle("loading", isSubmitting);
  }

  function bandFor(score) {
    if (score < 4) {
      return {
        key: "strained",
        label: "Strained",
        color: "var(--band-strained)",
        context: "Your answers point to a lot of strain right now. Small changes to sleep or screen time can help.",
      };
    }
    if (score < 7) {
      return {
        key: "steady",
        label: "Steady",
        color: "var(--band-steady)",
        context: "Your rhythm looks fairly steady, with some room to rest and reset.",
      };
    }
    return {
      key: "strong",
      label: "Strong",
      color: "var(--band-strong)",
      context: "Your habits point to a well-supported, resilient baseline. Keep it up.",
    };
  }

  function countUp(el, to, ms) {
    if (prefersReducedMotion) {
      el.textContent = to.toFixed(1);
      return;
    }
    const start = performance.now();
    function frame(now) {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = (to * eased).toFixed(1);
      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function renderResult(score) {
    const clamped = Math.max(0, Math.min(10, score));
    const { label, context, color } = bandFor(clamped);

    scoreSubEl.textContent = "out of 10";
    scoreBandEl.textContent = label;
    scoreContextEl.textContent = context;
    readout.style.setProperty("--band", color);
    stateResult.querySelector(".band-dot").style.setProperty("--band", color);

    // move the marker from the start to the score
    scaleMarker.style.transition = "none";
    scaleMarker.style.left = "0%";
    showState("result");
    // force a reflow so the transition restarts
    void scaleMarker.offsetWidth;
    scaleMarker.style.transition = "";
    scaleMarker.style.left = `${(clamped / 10) * 100}%`;

    countUp(scoreNumberEl, score, 900);

    if (window.innerWidth <= 960) {
      readout.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "start" });
    }
  }

  function resetScoreDisplay() {
    scoreNumberEl.textContent = "–";
    scoreSubEl.textContent = "score out of 10";
  }

  function renderError(label, copy) {
    errorLabelEl.textContent = label;
    errorCopyEl.textContent = copy;
    scoreNumberEl.textContent = "–";
    showState("error");
    if (window.innerWidth <= 960) {
      readout.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "start" });
    }
  }

  // ---------------------------------------------------------
  // Parse FastAPI / Pydantic 422 error responses into
  // field-level messages where possible (unchanged)
  // ---------------------------------------------------------
  function applyServerValidationErrors(detail) {
    if (!Array.isArray(detail)) return false;
    let matched = false;
    detail.forEach((err) => {
      const field = Array.isArray(err.loc) ? err.loc[err.loc.length - 1] : null;
      const target = field ? document.getElementById(field) : null;
      if (target) {
        setFieldError(target, err.msg || "Invalid value.");
        matched = true;
      }
    });
    return matched;
  }

  // ---------------------------------------------------------
  // Submit handler
  // ---------------------------------------------------------
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearAllErrors();

    const payload = collectPayload();
    const clientErrors = validate(payload);

    if (clientErrors.length > 0) {
      clientErrors.forEach(([input, msg]) => input && setFieldError(input, msg));
      focusField(clientErrors[0][0]);
      return;
    }

    setSubmitting(true);
    scoreNumberEl.textContent = "…";
    loadingCopyEl.textContent = "Running them through the model.";
    showState("loading");

    // if the server is asleep, tell the person why it is slow
    const slowTimer = setTimeout(() => {
      loadingCopyEl.textContent =
        "The server is waking up after being idle. The first score can take up to a minute.";
    }, 6000);

    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch(`${API_BASE}/predict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (res.status === 422) {
        const body = await res.json().catch(() => null);
        const matched = body && applyServerValidationErrors(body.detail);
        renderError(
          "Check your answers",
          matched
            ? "The model rejected a few fields. They're marked on the form."
            : "The model rejected this submission. Review your answers and try again."
        );
        return;
      }

      if (!res.ok) {
        let detailMsg = `The server responded with status ${res.status}.`;
        const body = await res.json().catch(() => null);
        if (body && typeof body.detail === "string") detailMsg = body.detail;
        renderError("Couldn't get a score", detailMsg);
        return;
      }

      const data = await res.json();
      if (typeof data.predicted_mental_health_score !== "number") {
        renderError("Unexpected response", "The server replied, but the score was missing or malformed.");
        return;
      }

      renderResult(data.predicted_mental_health_score);
    } catch (err) {
      if (err && err.name === "AbortError") {
        renderError("Taking too long", "The server didn't answer in time. Wait a moment and try again.");
      } else {
        renderError(
          "Can't reach the server",
          `Couldn't connect to ${API_BASE}. Check your internet connection and try again.`
        );
      }
    } finally {
      clearTimeout(slowTimer);
      clearTimeout(abortTimer);
      setSubmitting(false);
    }
  });

  // live-clear errors as the person edits
  form.querySelectorAll("input, select").forEach((el) => {
    el.addEventListener("input", () => clearFieldError(el));
    el.addEventListener("change", () => clearFieldError(el));
  });

  resetBtn.addEventListener("click", () => {
    resetScoreDisplay();
    showState("idle");
    if (window.innerWidth <= 960) {
      form.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "start" });
    }
  });

  errorRetryBtn.addEventListener("click", () => {
    resetScoreDisplay();
    showState("idle");
  });
})();
