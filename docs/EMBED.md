# Embedding the salespoints on another website

The app offers two pages made for iframes:

| Page | Shows |
|---|---|
| `/embed/map` | Only the map, filling the whole iframe. Mouse-wheel zoom is off so it does not hijack page scrolling; use the +/- buttons or pinch. |
| `/embed/list` | Only the contact cards. Reports its height to the host page so the iframe grows to fit. Each card with a map position gets a "Toon op kaart" button. |

The full page at `/` is unchanged.

## Snippet for the host website

Paste this where the map and the list should appear. The two iframes may be
placed apart from each other; keep the script once, after both.

```html
<!-- Illus verkooppunten: kaart -->
<iframe id="illus-map" src="https://salespoints.bpitconsulting.be/embed/map"
        title="Illus verkooppunten – kaart" loading="lazy"
        style="display:block;width:100%;height:600px;border:0"></iframe>

<!-- Illus verkooppunten: lijst (hoogte past zich automatisch aan) -->
<iframe id="illus-list" src="https://salespoints.bpitconsulting.be/embed/list"
        title="Illus verkooppunten – lijst" scrolling="no"
        style="display:block;width:100%;height:800px;border:0"></iframe>

<script>
(function () {
  var ORIGIN = "https://salespoints.bpitconsulting.be";
  var map = document.getElementById("illus-map");
  var list = document.getElementById("illus-list");
  window.addEventListener("message", function (event) {
    var data = event.data;
    if (event.origin !== ORIGIN || !data || typeof data.type !== "string") return;
    if (data.type === "illus-salespoints:height" && list && event.source === list.contentWindow) {
      list.style.height = data.height + "px";
    } else if (data.type === "illus-salespoints:select" && map) {
      map.contentWindow.postMessage({ type: data.type, id: data.id }, ORIGIN);
      map.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  });
})();
</script>
```

The script is optional but recommended. Without it the list iframe keeps its
fixed height (800px) and "Toon op kaart" does nothing.

## Messages

All messages are posted with `window.postMessage` and only contain public data.

| `type` | From → to | Data |
|---|---|---|
| `illus-salespoints:height` | list → host | `height` in pixels |
| `illus-salespoints:select` | list → host → map | `id` of the sales point to show |
