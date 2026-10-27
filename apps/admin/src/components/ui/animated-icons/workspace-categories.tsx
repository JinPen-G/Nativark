/** Original Hugeicons artwork, animated with the existing Animate UI icon engine.
 * These category gestures are local adaptations, not upstream registry variants. */
import { motion, type Variants, type TargetAndTransition } from "motion/react";
import { createElement } from "react";
import { Camera01Icon, Car01Icon, TentIcon, ExcavatorIcon } from "@hugeicons/core-free-icons";
import { getVariants, IconWrapper, useAnimateIconContext, type IconProps } from "./runtime";

function categoryIcon(artwork: typeof Camera01Icon, gesture: TargetAndTransition) {
  const animations = { default: { group: {
    initial: { x: 0, y: 0, rotate: 0, scale: 1 },
    animate: { ...gesture, transition: { duration: 0.55, ease: "easeInOut" } },
  } satisfies Variants } };
  function Drawing({ size, strokeWidth, ...props }: IconProps<"default">) {
    const { controls } = useAnimateIconContext();
    const variants = getVariants(animations);
    return <motion.svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...props}>
      <motion.g variants={variants.group} initial="initial" animate={controls} style={{ transformOrigin: "center" }}>
        {artwork.map(([tag, attributes], index) => createElement(tag, { ...attributes, key: index, strokeWidth: strokeWidth ?? attributes.strokeWidth }))}
      </motion.g>
    </motion.svg>;
  }
  return function CategoryIcon(props: IconProps<"default">) { return <IconWrapper icon={Drawing} {...props} />; };
}

export const WorkspaceCamera = categoryIcon(Camera01Icon, { scale: [1, 0.9, 1] });
export const WorkspaceVehicle = categoryIcon(Car01Icon, { x: [0, 1.5, 0], y: [0, -0.6, 0] });
export const WorkspaceCamping = categoryIcon(TentIcon, { rotate: [0, -5, 3, 0] });
export const WorkspaceConstruction = categoryIcon(ExcavatorIcon, { rotate: [0, -4, 2, 0] });
