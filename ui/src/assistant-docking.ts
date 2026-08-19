export type AssistantDockRect = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

type AssistantDockOptions = {
  viewportHeight: number;
  handleLeft: number;
  handleRight: number;
  controls: AssistantDockRect[];
  preferredRatio?: number;
  handleHeight?: number;
  gap?: number;
  viewportInset?: number;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function chooseAssistantHandleCenter({
  viewportHeight,
  handleLeft,
  handleRight,
  controls,
  preferredRatio = .8,
  handleHeight = 52,
  gap = 2,
  viewportInset = 16,
}: AssistantDockOptions) {
  const halfHeight = handleHeight / 2;
  const minimum = halfHeight + viewportInset;
  const maximum = Math.max(minimum, viewportHeight - halfHeight - viewportInset);
  const preferred = clamp(viewportHeight * preferredRatio, minimum, maximum);
  const nearbyControls = controls.filter((control) => control.right > handleLeft && control.left < handleRight);
  const candidates = [
    preferred,
    ...nearbyControls.flatMap((control) => [control.top - halfHeight - gap, control.bottom + halfHeight + gap]),
    maximum,
    minimum,
  ]
    .map((candidate) => clamp(candidate, minimum, maximum))
    .sort((left, right) => Math.abs(left - preferred) - Math.abs(right - preferred));

  return candidates.find((candidate) => nearbyControls.every((control) => (
    candidate + halfHeight + gap <= control.top || candidate - halfHeight - gap >= control.bottom
  ))) ?? preferred;
}
