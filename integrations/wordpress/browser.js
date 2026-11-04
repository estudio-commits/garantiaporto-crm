(function ($) {
  "use strict";
  if (window.portoCrmBridge) return;
  window.portoCrmBridge = true;
  var key = "porto-crm-request-v1",
    state;
  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    var bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    var hex = Array.from(bytes, function (b) {
      return b.toString(16).padStart(2, "0");
    }).join("");
    return (
      hex.slice(0, 8) +
      "-" +
      hex.slice(8, 12) +
      "-" +
      hex.slice(12, 16) +
      "-" +
      hex.slice(16, 20) +
      "-" +
      hex.slice(20)
    );
  }
  function save() {
    try {
      sessionStorage.setItem(key, JSON.stringify(state));
    } catch (_) {}
  }
  function fresh() {
    state = { id: uuid(), events: { 1: uuid(), 2: uuid() }, completed: false };
    save();
  }
  try {
    state = JSON.parse(sessionStorage.getItem(key));
  } catch (_) {}
  if (!state || !state.id || !state.events) fresh();
  function step(form) {
    if (
      form.id === "garantia_paso_1" ||
      $(form).closest(".form-garantia-paso1,#garantia-paso-1").length
    )
      return 1;
    if (
      form.id === "garantia_paso_2" ||
      $(form).closest(".form-garantia-paso2,#garantia-paso-2").length
    )
      return 2;
    return 0;
  }
  function field(form, id) {
    return form.querySelector('[name="form_fields[' + id + ']"]');
  }
  function fill(form, n) {
    var request = field(form, "solicitud_id"),
      event = field(form, "event_id");
    if (request) request.value = state.id;
    if (event) event.value = state.events[n];
    // Keep existing attribution. Fill only the URL/page fallback when blank.
    var url = field(form, "url_origen"),
      page = field(form, "pagina_origen");
    if (url && !url.value) url.value = location.href;
    if (page && !page.value) page.value = document.title;
  }
  function fillAll() {
    document.querySelectorAll("form.elementor-form").forEach(function (f) {
      var n = step(f);
      if (n) fill(f, n);
    });
  }
  // Capture phase runs before Elementor serializes the submitted fields.
  document.addEventListener(
    "submit",
    function (event) {
      var form = event.target,
        n = step(form);
      if (!n) return;
      if (n === 1 && state.completed) fresh();
      fill(form, n);
    },
    true,
  );
  $(document).on("elementor/popup/show.portoCrm", function () {
    if (state.completed) fresh();
    fillAll();
    setTimeout(fillAll, 150);
  });
  $(document).on("submit_success.portoCrm", function (event) {
    var n = step(event.target);
    if (n === 1) fillAll();
    if (n === 2) {
      state.completed = true;
      save();
    }
  });
  fillAll();
})(jQuery);
