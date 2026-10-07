import { useEffect, useRef } from "react";
import { ProjectDirectory } from "@/components/map-view";
import { EMBED_MESSAGE, postToParent } from "@/lib/embed";

/**
 * Contact cards only: <iframe src="https://…/embed/list">
 * Reports its content height to the host page so the iframe can grow to fit.
 */
export default function EmbedList() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = "Illus | Salespoints – verkooppunten";
    // Blend into the host page instead of showing the app's background colour.
    const previous = document.body.style.background;
    document.body.style.background = "transparent";
    return () => {
      document.body.style.background = previous;
    };
  }, []);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let last = 0;
    const report = () => {
      const height = Math.ceil(element.getBoundingClientRect().height);
      if (height !== last) {
        last = height;
        postToParent({ type: EMBED_MESSAGE.height, height });
      }
    };
    const observer = new ResizeObserver(report);
    observer.observe(element);
    report();
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className="p-1" data-testid="embed-list">
      <ProjectDirectory embedded />
    </div>
  );
}
