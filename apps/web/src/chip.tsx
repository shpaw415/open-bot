import MuiChip, { type ChipProps } from "@shpaw415/mui-lite/Chip"

// mui-lite's Chip renders only its children; a `label` prop falls through to
// the DOM as an attribute and the badge renders empty. This wrapper keeps the
// familiar MUI-style `label` API and always produces visible, screen-reader
// readable text.
export type LabelChipProps = ChipProps & { label?: React.ReactNode }

export function Chip({ label, children, ...props }: LabelChipProps) {
  const content = children ?? label
  return <MuiChip {...props}>{content}</MuiChip>
}

export default Chip
