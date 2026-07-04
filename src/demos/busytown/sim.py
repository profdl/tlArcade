"""
Busytown 'feel' simulation -- NOT an ecosystem. No conservation, no energy.
Goal: measure how many INTERACTIONS are happening at any moment as a function
of roster size, so we can pick starting counts that hover around 1-2 concurrent.

Model (the 'faked' design):
  - Props advertise affordances at fixed spots: benches (sit), stall (shop),
    houses (home/spawn), trees (perch).
  - Townsfolk carry a 'whim' (shop / rest / wander / home), walk toward the
    nearest matching affordance with visible intent, dwell, then re-roll.
  - Interactions are discrete events with a duration. We count how many are
    active each tick. That count is the thing the player reads as 'busy'.

Interaction types counted:
  greet     two walking townsfolk pass close -> brief pause + bubble
  bench     two townsfolk seated on the same bench -> chat
  buy       townsperson at the stall (stock>0)
  restock   van stopped at the stall
  flee      a bird startled by a nearby townsperson/van
"""
import math, random

W, H = 1000, 700
TICK = 1                      # abstract tick; ~100ms in the real app (10 fps)
WALK = 8.0                    # px per tick -> crosses canvas in ~125 ticks (~12s)
GREET_R = 45                  # proximity that triggers a greeting
GREET_DUR = 20                # ticks a greeting lasts (~2s)
GREET_COOL = 120             # ticks before the same pair can greet again
BENCH_CAP = 2
DWELL_BENCH = (60, 140)       # ticks seated
DWELL_STALL = (10, 25)        # ticks buying
WHIM_COOL = (15, 60)          # idle ticks between whims
FLEE_R = 70                   # how close before a bird bolts
FLEE_DUR = 25
BIRD_PERCH = (200, 500)       # ticks perched before a voluntary short hop

# --- fixed prop layout (the 'scenery' that shapes behavior) ---
HOUSES  = [(120, 90), (500, 70), (880, 90)]
BENCHES = [(300, 470), (720, 470)]
STALL   = (500, 410)
TREES   = [(180, 250), (820, 250), (500, 560)]
PATH_Y  = 350                 # the van drives along here


def dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


class Town:
    def __init__(self, n_people, n_birds, seed):
        self.rng = random.Random(seed)
        self.t = 0
        self.stall_stock = 5
        self.people = [self._spawn_person() for _ in range(n_people)]
        self.birds = [self._spawn_bird() for _ in range(n_birds)]
        self.van = {"x": -50.0, "y": PATH_Y, "state": "drive", "timer": 0}
        self.greet_log = {}          # frozenset(pair) -> last greet tick
        self.active = []             # list of (kind, end_tick) active interactions

    def _spawn_person(self):
        h = self.rng.choice(HOUSES)
        p = {"x": h[0] + self.rng.uniform(-20, 20),
             "y": h[1] + self.rng.uniform(-20, 20),
             "whim": None, "target": None, "state": "idle",
             "timer": self.rng.randint(0, 40), "bench": None}
        return p

    def _spawn_bird(self):
        tree = self.rng.choice(TREES)
        return {"x": tree[0], "y": tree[1], "state": "perch",
                "timer": self.rng.randint(*BIRD_PERCH)}

    # ---- whim selection: what does this townsperson want next ----
    def _roll_whim(self, p):
        roll = self.rng.random()
        if roll < 0.40:
            p["whim"] = "shop";   p["target"] = STALL
        elif roll < 0.75:
            p["whim"] = "rest";   p["target"] = self._free_bench(p)
        elif roll < 0.90:
            p["whim"] = "wander"; p["target"] = (self.rng.uniform(100, W-100),
                                                 self.rng.uniform(380, H-60))
        else:
            p["whim"] = "home";   p["target"] = self.rng.choice(HOUSES)
        if p["target"] is None:      # no free bench -> wander instead
            p["whim"] = "wander"
            p["target"] = (self.rng.uniform(100, W-100), self.rng.uniform(380, H-60))
        p["state"] = "walk"

    def _free_bench(self, me):
        for b in BENCHES:
            seated = sum(1 for q in self.people if q is not me and q.get("bench") == b)
            if seated < BENCH_CAP:
                return b
        return None

    def step(self):
        self.t += 1
        now_active = []

        # ---- van: drive -> stop at stall to restock -> drive off ----
        v = self.van
        if v["state"] == "drive":
            v["x"] += WALK * 1.6
            if abs(v["x"] - STALL[0]) < 8 and v["timer"] == 0:
                v["state"] = "restock"; v["timer"] = 18
            if v["x"] > W + 60:
                v["x"] = -50.0; v["timer"] = 0
        elif v["state"] == "restock":
            v["timer"] -= 1
            now_active.append("restock")
            if v["timer"] <= 0:
                self.stall_stock = 5
                v["state"] = "drive"; v["timer"] = 1
                # small cooldown so it doesn't immediately re-trigger
        if v["state"] == "drive" and v["timer"] > 0:
            v["timer"] = 0

        # ---- townsfolk movement + dwell ----
        for p in self.people:
            if p["state"] == "idle":
                p["timer"] -= 1
                if p["timer"] <= 0:
                    self._roll_whim(p)
            elif p["state"] == "walk":
                tx, ty = p["target"]
                d = dist((p["x"], p["y"]), (tx, ty))
                if d < WALK:
                    p["x"], p["y"] = tx, ty
                    self._arrive(p)
                else:
                    p["x"] += WALK * (tx - p["x"]) / d
                    p["y"] += WALK * (ty - p["y"]) / d
            elif p["state"] == "sit":
                p["timer"] -= 1
                # bench chat: 2 on same bench -> ongoing interaction
                if p["timer"] <= 0:
                    p["bench"] = None
                    p["state"] = "idle"; p["timer"] = self.rng.randint(*WHIM_COOL)
            elif p["state"] == "shop":
                p["timer"] -= 1
                now_active.append("buy")
                if p["timer"] <= 0:
                    p["state"] = "idle"; p["timer"] = self.rng.randint(*WHIM_COOL)

        # bench chats (count once per full bench)
        for b in BENCHES:
            seated = [q for q in self.people if q.get("bench") == b and q["state"] == "sit"]
            if len(seated) >= 2:
                now_active.append("bench")

        # ---- greetings: walking pairs that pass close ----
        walkers = [p for p in self.people if p["state"] == "walk"]
        for i in range(len(walkers)):
            for j in range(i + 1, len(walkers)):
                a, b = walkers[i], walkers[j]
                if dist((a["x"], a["y"]), (b["x"], b["y"])) < GREET_R:
                    key = frozenset((id(a), id(b)))
                    if self.t - self.greet_log.get(key, -10**9) > GREET_COOL:
                        self.greet_log[key] = self.t
                        a["_greet"] = b["_greet"] = self.t + GREET_DUR
        for p in self.people:
            if p.get("_greet", 0) > self.t:
                now_active.append("greet")
                break_pair = True  # counted per person; dedupe below
        # dedupe greet: count pairs, not people
        greeters = [p for p in self.people if p.get("_greet", 0) > self.t]
        # each greet involves 2 people -> active greets = pairs
        now_active = [x for x in now_active if x != "greet"]
        now_active += ["greet"] * (len(greeters) // 2)

        # ---- birds: flee if a person or the van is close ----
        for bird in self.birds:
            threats = [(p["x"], p["y"]) for p in self.people] + [(v["x"], v["y"])]
            near = min((dist((bird["x"], bird["y"]), t) for t in threats), default=999)
            if bird["state"] == "perch":
                if near < FLEE_R:
                    bird["state"] = "flee"; bird["timer"] = FLEE_DUR
                else:
                    bird["timer"] -= 1
                    if bird["timer"] <= 0:           # voluntary hop to a new tree
                        tree = self.rng.choice(TREES)
                        bird["x"], bird["y"] = tree
                        bird["timer"] = self.rng.randint(*BIRD_PERCH)
            elif bird["state"] == "flee":
                now_active.append("flee")
                bird["timer"] -= 1
                bird["y"] -= 6
                bird["x"] += 4
                if bird["timer"] <= 0:
                    tree = self.rng.choice(TREES)
                    bird["x"], bird["y"] = tree
                    bird["state"] = "perch"; bird["timer"] = self.rng.randint(*BIRD_PERCH)

        self.last = now_active
        return len(now_active)

    def _arrive(self, p):
        if p["whim"] == "rest":
            p["bench"] = p["target"]; p["state"] = "sit"
            p["timer"] = self.rng.randint(*DWELL_BENCH)
        elif p["whim"] == "shop":
            if self.stall_stock > 0:
                self.stall_stock -= 1
                p["state"] = "shop"; p["timer"] = self.rng.randint(*DWELL_STALL)
            else:
                p["state"] = "idle"; p["timer"] = self.rng.randint(*WHIM_COOL)
        else:  # wander / home
            p["state"] = "idle"; p["timer"] = self.rng.randint(*WHIM_COOL)


def run(n_people, n_birds, ticks=6000, seeds=6):
    import statistics
    means, dead, busy = [], [], []
    for s in range(seeds):
        town = Town(n_people, n_birds, seed=s)
        counts = []
        for _ in range(ticks):
            counts.append(town.step())
        means.append(statistics.mean(counts))
        dead.append(sum(1 for c in counts if c == 0) / len(counts))
        busy.append(sum(1 for c in counts if c >= 4) / len(counts))
    return (statistics.mean(means), statistics.mean(dead), statistics.mean(busy))


if __name__ == "__main__":
    print(f"{'people':>6} {'birds':>5} | {'mean concurrent':>15} {'% dead (0)':>11} {'% busy (>=4)':>12}")
    print("-" * 58)
    for people in (3, 5, 7, 9, 12, 16):
        for birds in (3, 6):
            m, d, b = run(people, birds)
            print(f"{people:>6} {birds:>5} | {m:>15.2f} {d*100:>10.1f}% {b*100:>11.1f}%")
