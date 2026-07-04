import {
	DefaultStylePanel,
	StylePanelColorPicker,
	StylePanelOpacityPicker,
	StylePanelSection,
	TldrawUiButton,
	TldrawUiButtonIcon,
	TldrawUiButtonLabel,
	useEditor,
	useValue,
	type TLUiIconJsx,
	type TLUiStylePanelProps,
} from 'tldraw'
import type { FaceVideoShape } from './faceVideoShape'

/**
 * Swaps in two face-video-specific toggles (and the standard color picker, once the video feed
 * is hidden) when every selected shape is a face-video shape. Otherwise renders the stock panel.
 */
export function FaceVideoStylePanel(props: TLUiStylePanelProps) {
	const editor = useEditor()
	const faceVideoShapes = useValue(
		'selected face-video shapes',
		() => {
			const selected = editor.getSelectedShapes()
			return selected.length > 0 && selected.every((s): s is FaceVideoShape => s.type === 'face-video')
				? (selected as FaceVideoShape[])
				: null
		},
		[editor]
	)

	if (!faceVideoShapes) {
		return <DefaultStylePanel {...props} />
	}

	const showMarkers = faceVideoShapes.every((s) => s.props.showMarkers)
	const showVideo = faceVideoShapes.every((s) => s.props.showVideo)

	const toggleMarkers = () => {
		editor.updateShapes(
			faceVideoShapes.map((s) => ({ id: s.id, type: 'face-video' as const, props: { showMarkers: !showMarkers } }))
		)
	}
	const toggleVideo = () => {
		editor.updateShapes(
			faceVideoShapes.map((s) => ({ id: s.id, type: 'face-video' as const, props: { showVideo: !showVideo } }))
		)
	}

	return (
		<DefaultStylePanel {...props}>
			<StylePanelSection>
				<StylePanelOpacityPicker />
			</StylePanelSection>
			<StylePanelSection>
				<ToggleRow icon={markersIcon} label="Markers" title="Show face markers" isActive={showMarkers} onClick={toggleMarkers} />
				<ToggleRow icon={videoIcon} label="Video" title="Show video" isActive={showVideo} onClick={toggleVideo} />
			</StylePanelSection>
			{!showVideo && (
				<StylePanelSection>
					<StylePanelColorPicker />
				</StylePanelSection>
			)}
		</DefaultStylePanel>
	)
}

function ToggleRow({
	icon,
	label,
	title,
	isActive,
	onClick,
}: {
	icon: TLUiIconJsx
	label: string
	title: string
	isActive: boolean
	onClick: () => void
}) {
	return (
		<TldrawUiButton type="normal" tooltip={title} isActive={isActive} onClick={onClick}>
			<TldrawUiButtonIcon icon={icon} />
			<TldrawUiButtonLabel>{label}</TldrawUiButtonLabel>
		</TldrawUiButton>
	)
}

// TldrawUiIcon only applies the sizing CSS from its base `tlui-icon` class to built-in (string)
// icons, not to custom JSX ones — and that class also sets `background-color: currentColor`,
// which is meant for mask-based icons and would paint over these path-based ones. So custom
// icons size themselves explicitly instead of borrowing that class.
const iconRootProps = { width: 18, height: 18, style: { flexShrink: 0 } } as const

const markersIcon: TLUiIconJsx = (
	<svg {...iconRootProps} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
		<circle cx="12" cy="12" r="7.25" stroke="currentColor" strokeWidth="1.5" />
		<circle cx="12" cy="12" r="2.25" fill="currentColor" />
	</svg>
)

const videoIcon: TLUiIconJsx = (
	<svg {...iconRootProps} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
		<rect x="3.5" y="6.5" width="12" height="11" rx="1.75" fill="currentColor" />
		<path d="M16.5 10.4L20.5 7.75V16.25L16.5 13.6V10.4Z" fill="currentColor" />
	</svg>
)
