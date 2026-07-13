import { BindingUtil, type BindingOnShapeChangeOptions, type TLShapePartial } from 'tldraw'
import { normalizeAngle } from '../pose/ik'
import { boneAttachmentBindingProps, type BoneAttachmentBinding } from './boneAttachmentBinding'

/**
 * Keeps a drawn shape rigidly attached to a bone so the artwork poses with the rig.
 *
 * The binding stores the shape's offset in the bone's LOCAL frame (dx, dy, rot),
 * captured at attach time (see attachDrawing). This util's job is the reverse map:
 * whenever the bone moves/rotates (`onAfterChangeFromShape` fires on the bone), take
 * that fixed local offset back out to page space and write the shape's new page
 * position + rotation. The shape rides the bone exactly, at any pose.
 *
 * We never write back onto the bone (attachments are one-way: bone drives art), so
 * there's no echo to guard against — unlike the two-way bone-joint binding.
 */
export class BoneAttachmentBindingUtil extends BindingUtil<BoneAttachmentBinding> {
	static override type = 'bone-attachment' as const
	static override props = boneAttachmentBindingProps

	override getDefaultProps() {
		return { dx: 0, dy: 0, rot: 0 }
	}

	override onAfterCreate({ binding }: { binding: BoneAttachmentBinding }) {
		// Lock the attached shape so it's inert to direct interaction: it can't be
		// selected or dragged, and a pointerdown over it passes THROUGH to the bone
		// behind it — so dragging on the drawing poses the rig instead of moving the
		// loose shape. This holds even when the rig is hidden (bones still exist and
		// remain hit-testable via their geometry). The rig still repositions the shape
		// via place(), which runs with ignoreShapeLock so the lock doesn't freeze it.
		const shape = this.editor.getShape(binding.toId)
		if (shape && !shape.isLocked) {
			// history:'ignore' so an undo can't unlock the shape while its attachment binding
			// stays live — that would desync the lock from the binding's "art rides the bone,
			// user can't grab it directly" invariant. The lock is a consequence of the binding
			// existing, not an independently-undoable user edit.
			this.editor.run(
				() => {
					this.editor.updateShape({ id: binding.toId, type: shape.type, isLocked: true } as TLShapePartial)
				},
				{ history: 'ignore' }
			)
		}
		this.place(binding)
	}

	override onAfterChangeFromShape({ binding }: BindingOnShapeChangeOptions<BoneAttachmentBinding>) {
		// The bone (fromId) moved or rotated — re-place the attached shape.
		this.place(binding)
	}

	override onAfterDelete({ binding }: { binding: BoneAttachmentBinding }) {
		// Attachment removed (e.g. the bone was deleted) — release the shape's lock so
		// it becomes a normal, selectable drawing again.
		const shape = this.editor.getShape(binding.toId)
		if (shape?.isLocked) {
			// history:'ignore' to match the lock write in onAfterCreate — the unlock mirrors
			// the binding being gone, not a standalone undoable edit.
			this.editor.run(
				() => {
					this.editor.updateShape({ id: binding.toId, type: shape.type, isLocked: false } as TLShapePartial)
				},
				{ history: 'ignore' }
			)
		}
	}

	/**
	 * Position the attached shape at its stored local offset within the bone's frame.
	 * `fromId` is the bone, `toId` the drawn shape.
	 */
	private place(binding: BoneAttachmentBinding) {
		const bone = this.editor.getShape(binding.fromId)
		const shape = this.editor.getShape(binding.toId)
		if (!bone || !shape) return

		// Bone's page transform maps local (dx, dy) → the shape origin's page point.
		const boneTransform = this.editor.getShapePageTransform(binding.fromId)
		const pagePoint = boneTransform.applyToPoint({ x: binding.props.dx, y: binding.props.dy })
		// Page rotation = bone's page rotation + the stored relative rotation.
		const pageRotation = boneTransform.rotation() + binding.props.rot

		// Convert the target page point into the shape's own tldraw-parent space (its
		// x/y are stored in parent coords, which is the page here).
		const parentPoint = this.editor.getPointInParentSpace(binding.toId, pagePoint)

		const samePos = Math.abs(shape.x - parentPoint.x) < 0.01 && Math.abs(shape.y - parentPoint.y) < 0.01
		const sameRot = Math.abs(normalizeAngle(shape.rotation - pageRotation)) < 0.0001
		if (samePos && sameRot) return // already placed — avoid thrash

		// The attached shape is LOCKED (so the user can't grab it directly and drags
		// pass through to the bone). But updateShape refuses to move a locked shape, so
		// the rig's own reposition must run with ignoreShapeLock — otherwise the drawing
		// freezes while the bone moves away from it.
		this.editor.run(
			() => {
				this.editor.updateShape({
					id: binding.toId,
					type: shape.type,
					x: parentPoint.x,
					y: parentPoint.y,
					rotation: pageRotation,
				} as TLShapePartial)
			},
			{ ignoreShapeLock: true }
		)
	}
}
