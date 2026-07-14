import { createBindingPropsMigrationSequence, createShapePropsMigrationSequence } from 'tldraw'

/**
 * Persistence migrations for the poser demo's custom records.
 *
 * The demo persists to localStorage (`persistenceKey="poser"` in App.tsx), so real
 * documents outlive a session and can be loaded by a NEWER build. tldraw's supported
 * forward-compat mechanism is a props-migration sequence per custom shape / binding.
 *
 * These sequences are currently EMPTY — v1 of every record's props. That's deliberate:
 * establishing the (empty) sequence now gives every future prop change a home, and
 * makes the "you must migrate" rule impossible to forget.
 *
 * ⚠️ Whenever you add / rename / remove a prop on `poser-bone`, `bone-joint`, or
 * `bone-attachment`, you MUST append a migration step here (see the tldraw docs at
 * docs/tldraw/llms-docs.txt → "Shape props migrations"), or old stored documents fail
 * to load. Give each step an incrementing id and an up() (plus down() if you support
 * multiplayer peers on an older schema).
 */

export const boneShapeMigrations = createShapePropsMigrationSequence({
	sequence: [],
})

export const boneJointBindingMigrations = createBindingPropsMigrationSequence({
	sequence: [],
})

export const boneAttachmentBindingMigrations = createBindingPropsMigrationSequence({
	sequence: [],
})
