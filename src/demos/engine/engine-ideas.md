# Web Side-Scroller Engine Architecture & Phased Development Blueprint
## Technical Reference Specification for Modular Toolkit Design

This document maps out the phased implementation of a high-performance, web-optimized 2D kinematic engine. It acts as a guide to transitioning a rigid platformer structure into a highly modular toolset capable of replicating iconic, disruptive indie game mechanics.

---

## Phase 1: Core Kinematic Foundations & Feel Tuning
**Objective:** Establish the bedrock 2D kinematic physics loops, deterministic input buffers, and tight movement feel parameters. This phase creates a highly responsive, non-floaty platformer base.

### Core Physics & Platformer Metrics
| Variable / Property Name | Data Type | Default Value | Functional Description |
| :--- | :--- | :--- | :--- |
| `move_acceleration` | Float | `1200.0` | Rate of horizontal velocity increase per second on standard terrain[cite: 1, 3]. |
| `move_deceleration` | Float | `1600.0` | Rate of horizontal velocity decay when no input direction is detected[cite: 1, 3]. |
| `max_horizontal_speed` | Float | `350.0` | Terminal ground velocity limit for normal player movement[cite: 1, 3]. |
| `turn_speed_multiplier` | Float | `2.5` | Snappiness scaling factor applied to deceleration when input direction opposes current movement sign[cite: 4]. |
| `air_acceleration_scale` | Float | `0.6` | Multiplier reducing horizontal input acceleration when actor is airborne (air control metric)[cite: 4]. |
| `air_brake_deceleration` | Float | `1000.0` | Deceleration rate applied when a player releases all movement buttons mid-air to instantly freeze forward momentum[cite: 4]. |
| `jump_force` | Float | `-650.0` | Initial upward vertical velocity impulse vector executed upon jump press[cite: 1, 3]. |
| `gravity_normal` | Float | `1800.0` | Downward acceleration applied to the kinematic body during normal falling cycles[cite: 1, 3]. |
| `time_to_jump_apex` | Float | `0.35` | Target duration in seconds designed for the player to travel from ground level to maximum jump height[cite: 4]. |
| `gravity_apex_modifier` | Float | `0.4` | Multiplier scale applied to gravity when vertical velocity approaches zero at the apex of a jump[cite: 1, 3]. |
| `downward_movement_multiplier`| Float | `2.0` | Gravity multiplier applied exclusively when falling (`velocity.y > 0`) to achieve a snappy, responsive landing curve[cite: 4]. |
| `variable_jump_cut_multiplier` | Float | `3.0` | Gravity modifier spiked instantly when the jump button is released prematurely before reaching natural apex[cite: 4]. |
| `coyote_time_duration` | Float | `0.08` | Time grace buffer in seconds allowing a jump input right after walking off a solid ledge[cite: 1, 3]. |
| `jump_buffer_time` | Float | `0.1` | Time frame window caching a jump input pressed prior to making contact with a solid surface[cite: 1, 3]. |
| `squash_stretch_intensity` | Float | `0.2` | Visual deformation delta applied to sprite rendering transform scales upon landing or initiating jumps[cite: 4]. |

---

## Phase 2: System Expansion, Environment & Combat Vitality
**Objective:** Introduce standard environmental components, hit registration systems, camera rules, and baseline AI types so designers can construct interactive layouts.

### Combat, Vitality & State Management
| Variable / Property Name | Data Type | Default Value | Functional Description |
| :--- | :--- | :--- | :--- |
| `max_health` | Integer | `3` | Total hit points or tiered state profile tracking (e.g., progression tiers)[cite: 1, 3]. |
| `invincibility_duration` | Float | `1.5` | Active lifespan in seconds of the i-frame collision masking system after taking hit damage[cite: 1, 3]. |
| `attack_cooldown` | Float | `0.3` | Minimum time step required between successive melee or ranged fire triggers[cite: 1, 3]. |
| `knockback_vector_x` | Float | `250.0` | Horizontal force metric applied to the player entity during damage state entry[cite: 2, 3]. |
| `knockback_vector_y` | Float | `-200.0` | Vertical bounce force metric applied to the player entity during damage state entry[cite: 2, 3]. |
| `collision_layer_mask` | Bitmask | `0x0001` | Bitwise designation defining physics collision behavior (Player, Enemy, Prop layers)[cite: 1, 3]. |
| `is_parry_active` | Boolean | `FALSE` | State evaluating if a directional parry/shield command blocks incoming hostile hitboxes[cite: 1, 3]. |

### Level Design, Environment & Camera Infrastructure
| Variable / Property Name | Data Type | Default Value | Functional Description |
| :--- | :--- | :--- | :--- |
| `tile_id` | String | `"tile_001"` | Database key hash connecting a chunk cell coordinate to its respective sprite asset sheet[cite: 2, 3]. |
| `is_solid` | Boolean | `TRUE` | Instructs the physics solver whether this block acts as a blocking kinematic collider[cite: 1, 3]. |
| `one_way_pass_through` | Boolean | `FALSE` | Enables collision logic ignoring bottom-up travel but resolving top-down landing contacts[cite: 3]. |
| `slope_angle` | Float | `0.0` | Angle mapping field used by the matrix solver to offset ground tracking vectors (0.0 to 45.0 degrees)[cite: 2, 3]. |
| `spring_launch_velocity` | Float | `-900.0` | Instant upward vertical impulse override applied when contact is made on a spring launch prop[cite: 1, 3]. |
| `switch_network_channel` | Integer | `0` | ID routing channel linking toggle block nodes to trigger plates/switches across the map[cite: 3]. |
| `is_instakill_hazard` | Boolean | `FALSE` | Flag forcing instant routing to player death sequence regardless of current health state variables[cite: 1, 3]. |
| `parallax_factor` | Float | `0.5` | Camera scroll translation tracking scaling coefficient determining background depth visual layer speeds (0.1 to 1.0)[cite: 2, 3]. |
| `camera_deadzone_width` | Float | `80.0` | Pixel width threshold bounding box where internal player movement does not trigger camera scrolling[cite: 1, 3]. |
| `camera_look_ahead_scale` | Float | `0.3` | Multiplier shifting camera target focal center forward based on current player velocity[cite: 3]. |

---

## Phase 3: Advanced Actions & Kinetic Hazards
**Objective:** Add advanced player navigation upgrades and responsive, synchronized environmental traps to shift pacing and level rhythm.

### Advanced Movement Subsystems
| Variable / Property Name | Data Type | Default Value | Functional Description |
| :--- | :--- | :--- | :--- |
| `wall_slide_friction` | Float | `0.15` | Friction dampening factor reducing downward slip speed while hugging a vertical solid surface[cite: 1, 3]. |
| `wall_jump_pushback_x` | Float | `400.0` | Horizontal impulse force redirected away from a wall tile during a wall-jump solver execution[cite: 2, 3]. |
| `wall_jump_pushback_y` | Float | `-500.0` | Vertical upward impulse applied during a wall-jump execution[cite: 2, 3]. |
| `wall_jump_tolerance_pixels`| Float | `4.0` | Allowed proximity distance in pixels to a wall tile to successfully register a wall jump input[cite: 3]. |
| `dash_speed` | Float | `800.0` | Instantaneous horizontal velocity override applied during an active dash state[cite: 3]. |
| `dash_duration` | Float | `0.2` | Duration in seconds that the dash speed override remains active before returning to normal physics[cite: 3]. |
| `dash_cooldown` | Float | `0.5` | Time buffer required before a dash sequence can be re-triggered by input[cite: 3]. |
| `ledge_grab_offset_y` | Float | `16.0` | Vertical proximity range checked to auto-snap and anchor a player to a platform ledge edge[cite: 3]. |
| `pogo_bounce_velocity` | Float | `-600.0` | Instantaneous upward jump impulse applied if a downward melee strike successfully collides with an enemy hitbox[cite: 3]. |
| `flutter_jump_gravity_scale` | Float | `0.2` | Gravity reduction multiplier active while holding jump at the peak of a jump arc (Yoshi style)[cite: 3]. |
| `grapple_string_length` | Float | `200.0` | Maximum radius vector length for attaching a physics spring joint hook to grapple anchor nodes[cite: 3]. |
| `grapple_swing_force` | Float | `15.0` | Angular acceleration applied to pendulum movement when swinging left/right on a grapple hook[cite: 3]. |
| `swim_buoyancy` | Float | `400.0` | Upward vertical force vector automatically applied when entering fluid collision volumes[cite: 3]. |
| `swim_max_speed` | Float | `150.0` | Clamped top speed threshold applied when moving through water/fluid layers[cite: 3]. |

### Reactive Hazards & Dynamic Terrain
| Variable / Property Name | Data Type | Default Value | Functional Description |
| :--- | :--- | :--- | :--- |
| `surface_velocity_vector` | Vector2 | `(0.0, 0.0)` | Continuous horizontal/vertical positional force applied to kinematic bodies resting on or wading through this surface tile (conveyors/currents). |
| `global_sync_cycle_id` | Integer | `0` | Identifies which central clock loop a toggle hazard listens to for synchronized multi-object timing alignment. |
| `hazard_drop_gravity_scale`| Float | `4.5` | Gravity multiplier applied to crushing traps (e.g., Thwomps) once their tracking raycast triggers. |

---

## Phase 4: Dynamic AI Archetypes & Sensory Logic
**Objective:** Implement modular intelligence fields for enemies, decoupling behaviors from rigid script loops and supporting gaze-reactive, directional-shielded, and wave-tracking entities.

### Advanced Enemy Modules
| Variable / Property Name | Data Type | Default Value | Functional Description |
| :--- | :--- | :--- | :--- |
| `ai_archetype` | Enum | `PATROLLER` | State pattern loop archetype defining baseline logic (`PATROLLER`, `STALKER`, `AMBUSHER`, `FLYING_SWARMER`)[cite: 1, 3]. |
| `detection_radius` | Float | `300.0` | Raycast sweeps boundary distance used by tracking types to trace target player coordinates[cite: 2, 3]. |
| `turn_on_edge` | Boolean | `TRUE` | Forces roaming patrollers to negate heading vector when passing over a ledge block border[cite: 2, 3]. |
| `projectile_interval` | Float | `2.0` | Cyclic frequency cooldown regulating ranged enemy projectile spawning logic[cite: 2, 3]. |
| `sine_wave_amplitude` | Float | `50.0` | Vertical waveform distance offset calculating sinusoidal paths for flying swarmer units[cite: 2, 3]. |
| `sine_wave_frequency` | Float | `3.0` | Speed of the vertical oscillation cycle for curved paths or projectile arcs. |
| `gazing_trigger_state` | Boolean | `FALSE` | Triggers alternate state paths if the player's vector faces towards or away from the entity (e.g., Boo stealth mechanics). |
| `directional_armor_arc` | Float | `180.0` | Angle in degrees relative to heading direction where incoming player hitboxes register zero structural damage. |
| `shield_gate_active` | Boolean | `FALSE` | Enables an invulnerability mask blocking standard hitboxes until lowered during designated attack loops[cite: 3]. |
| `spawn_rate_seconds` | Float | `4.0` | Regeneration timer interval for infinite spawner nodes (e.g., Medusa head generators)[cite: 3]. |

---

## Phase 5: Sandbox Engine Modularization (Disruptive Indie Mechanics)
**Objective:** Transform the engine into an abstract toolkit. Pointers, bitwise masking filters, and variable lifecycles are exposed to empower designers to replicate complex hybrid mechanics from groundbreaking indie titles.

### Hybrid Genre Systems & Global Engine Mutators
| Variable / Property Name | Data Type | Default Value | Functional Description | Replicated Indie Inspiration |
| :--- | :--- | :--- | :--- | :--- |
| `puzzle_dimension_index` | Integer | `0` | Active coordinate defining which overlapping map layout layer is currently physically active[cite: 4]. | *FEZ / Minit* |
| `color_channel_mask` | Bitmask | `0x0001` | Bitwise operational filter used to switch visibility, parsing tiles as completely non-solid if masks overlap. | *Hue* |
| `time_dilation_scale` | Float | `1.0` | Global scale factor altering localized game time loops dynamically[cite: 4]. | *Superhot* |
| `rhythm_bpm_sync` | Float | `120.0` | Beats per minute constraint checking input frames for legal action execution windows[cite: 4]. | *Crypt of the Necrodancer* |
| `physics_gravity_inversion`| Boolean | `FALSE` | Global state rule swapping upward/downward vertical calculation baselines instantly[cite: 4]. | *VVVVVV* |
| `magnet_attraction_force` | Float | `500.0` | Impulse multiplier pulling the character toward targeted anchor layers or world entities[cite: 4]. | *Mind Over Magnet* |
| `card_deck_id_mask` | Bitmask | `0x0000` | Bitwise routing variable limiting active action/movement layers to items held in UI deck inventories[cite: 4]. | *Neon White / Card Crawl* |
| `stealth_visibility_factor`| Float | `1.0` | Coefficient determining player detection speed across enemy line-of-sight raycasts[cite: 4]. | *Mark of the Ninja* |
| `spawn_static_body_on_death`| Boolean | `FALSE` | Instantiates a static platform block matching the player's exact dead coordinate, altering world terrain. | *Life Goes On: Done to Death* |
| `is_persistent_on_reset` | Boolean | `FALSE` | Flag allowing specific entities, shortcuts, or states to bypass time-loop cleanups or health resets. | *Minit* |
| `rule_lookup_channel` | Integer | `0` | Pointers route asset identities into logic cells, turning properties like physical solidity into mutable states. | *Baba Is You* |

### Global Architecture & Engine Constraints
| System Attribute | Data Type | Default Value | Functional Purpose |
| :--- | :--- | :--- | :--- |
| `target_framerate` | Integer | `60` | Target FPS tracking for fixed delta-time integration scaling[cite: 1, 2, 3]. |
| `spatial_hash_cell_size` | Integer | `128` | Grid size in pixels partitioning levels to minimize collision solver overhead[cite: 1, 2, 3]. |
| `networking_mode` | Enum | `LOCAL_ONLY` | Synchronization strategy over network sockets (`LOCAL_ONLY`, `NET_ROLLBACK`, `GHOST_SYNC`)[cite: 1, 2, 3]. |
| `rollback_input_buffer` | Integer | `4` | Frame history count cached to handle predictive input rollback synchronization[cite: 3]. |
| `chunk_buffer_distance` | Integer | `2` | Number of off-screen tilemap segments kept active in memory during tracking[cite: 1, 2, 3]. |