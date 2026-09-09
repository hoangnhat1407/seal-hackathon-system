package com.seal.hackathon.config.seed;

import com.seal.hackathon.dto.request.AutoGeneratePrizesRequest;
import com.seal.hackathon.entity.HackathonEvent;
import com.seal.hackathon.entity.Round;
import com.seal.hackathon.entity.ScoringCriteria;
import com.seal.hackathon.entity.Submission;
import com.seal.hackathon.entity.Team;
import com.seal.hackathon.entity.Track;
import com.seal.hackathon.entity.User;
import com.seal.hackathon.repository.HackathonEventRepository;
import com.seal.hackathon.repository.UserRepository;
import com.seal.hackathon.service.HackathonEventService;
import com.seal.hackathon.service.PrizeService;
import com.seal.hackathon.service.RoundResultService;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.CommandLineRunner;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Dedicated multi-event demo seeder that creates 3 distinct hackathon events
 * simultaneously in the database for the year 2026:
 * <ul>
 *   <li><b>SEAL Spring 2026</b>: Scenario 1 (OPEN - registration open, 15 forming teams, solo, pair, leftover grouping).</li>
 *   <li><b>SEAL Summer 2026</b>: Scenario 2.5 (IN_PROGRESS - prelim finalized, final round fully scored, ready to calculate rankings).</li>
 *   <li><b>SEAL Fall 2026</b>: Scenario 3 (COMPLETED - finalized rankings, auto-generated prizes, published awards, system audit log).</li>
 * </ul>
 *
 * Activated when {@code app.seed.scenario=ALL} or {@code app.seed.scenario=MULTI}
 * or {@code app.seed.multi-event=true}.
 */
@Component
@Order(3)
@RequiredArgsConstructor
public class MultiEventDemoSeeder implements CommandLineRunner {

    private static final Logger log = LoggerFactory.getLogger(MultiEventDemoSeeder.class);

    public static final String SPRING_EVENT_NAME = "SEAL Spring 2026";
    public static final String SUMMER_EVENT_NAME = "SEAL Summer 2026";
    public static final String FALL_EVENT_NAME = "SEAL Fall 2026";

    public static final String COORDINATOR_EMAIL = "coordinator@fpt.edu.vn";
    private static final int YEAR = 2026;
    private static final int TOP_PER_TRACK_ADVANCE = 2;
    private static final int PRELIM_JUDGES_PER_TRACK = 2;
    private static final double MAX_SCORE = 10.0;

    private static final String[][] CRITERIA = {
            {"Ý tưởng", "1.0"}, {"Kỹ thuật", "1.5"}, {"UI/UX", "1.0"},
            {"Hoàn thiện", "1.0"}, {"Trình bày", "0.5"},
    };

    private static final double[] PRELIM_EVALUATION_TARGETS = {
            25,
            34, 38,
            42, 46, 49,
            52, 54, 56, 58, 59,
            62, 64, 65, 67, 68, 69,
            72, 73, 74, 75, 76, 77, 78, 79,
            82, 86, 89,
            93, 97,
    };

    private static final String[] TRACKS = {"Web Application", "AI Solution", "Education Tech", "Social Impact"};
    private static final int[] TEAMS_PER_TRACK = {4, 4, 4, 3};

    private static final String[] CLUBS = {
            "Arsenal", "Barcelona", "Real Madrid", "Bayern Munich",
            "Liverpool", "Manchester City", "Chelsea", "Juventus",
            "PSG", "AC Milan", "Inter Milan", "Tottenham",
            "Napoli", "Atlético Madrid", "Borussia Dortmund", "Ajax",
    };

    private static final String[] S1_EXTRA_APPROVED_TEAMS = {
            "Liverpool", "Manchester City", "PSG", "AC Milan", "Inter Milan",
            "Tottenham", "Napoli", "Atlético Madrid", "Borussia Dortmund",
    };

    private static final String[] PLAYERS = {
            "Lionel Messi", "Cristiano Ronaldo", "Kylian Mbappé", "Erling Haaland",
            "Kevin De Bruyne", "Vinícius Júnior", "Mohamed Salah", "Harry Kane",
            "Robert Lewandowski", "Luka Modrić", "Neymar Jr", "Sadio Mané",
            "Bukayo Saka", "Jude Bellingham", "Rodri", "Bernardo Silva",
            "Phil Foden", "Martin Ødegaard", "Rafael Leão", "Federico Valverde",
            "Pedri", "Gavi", "Jamal Musiala", "Florian Wirtz",
            "Antoine Griezmann", "Toni Kroos", "Virgil van Dijk", "Achraf Hakimi",
            "Lautaro Martínez", "Victor Osimhen", "Bruno Fernandes", "Son Heung-min",
            "Declan Rice", "Joško Gvardiol", "Alphonso Davies", "Nico Williams",
            "Cole Palmer", "Lamine Yamal", "Khvicha Kvaratskhelia", "Dušan Vlahović",
            "Enzo Fernández", "Aurélien Tchouaméni", "Randal Kolo Muani", "Ousmane Dembélé",
            "Trent Alexander-Arnold", "Marcus Rashford", "Riyad Mahrez", "Serge Gnabry",
    };

    private final DemoFixtures fx;
    private final UserRepository userRepo;
    private final HackathonEventRepository eventRepo;
    private final RoundResultService roundResultService;
    private final PrizeService prizeService;
    private final HackathonEventService hackathonEventService;

    @Value("${app.seed.scenario:NONE}")
    private String scenario;

    @Value("${app.seed.multi-event:false}")
    private boolean multiEventFlag;

    private int participantSeq = 0;
    private int maxStrength = 2;

    private record DemoStaff(
            User coordinator,
            List<User> judges,
            User guestJudgeSummer,
            User guestJudgeFall,
            List<User> mentors
    ) {}

    @Override
    @Transactional
    public void run(String... args) {
        String s = scenario == null ? "" : scenario.trim().toUpperCase();
        boolean shouldRun = multiEventFlag || "ALL".equals(s) || "MULTI".equals(s);
        if (!shouldRun) {
            return;
        }

        boolean springExists = eventExists(SPRING_EVENT_NAME);
        boolean summerExists = eventExists(SUMMER_EVENT_NAME);
        boolean fallExists = eventExists(FALL_EVENT_NAME);

        if (springExists && summerExists && fallExists) {
            log.info("[multi-seed] All 3 demo events (Spring, Summer, Fall 2026) already exist — skipping.");
            return;
        }

        log.info("[multi-seed] Starting multi-event demo seeding for Spring, Summer, and Fall 2026…");
        DemoStaff staff = getOrCreateStaff();

        if (!springExists) {
            seedSpringS1();
        }
        if (!summerExists) {
            seedSummerS25(staff);
        }
        if (!fallExists) {
            seedFallS3(staff);
        }

        log.info("[multi-seed] Multi-event demo seeding completed successfully!");
    }

    private boolean eventExists(String eventName) {
        return eventRepo.findAll().stream().anyMatch(e -> eventName.equalsIgnoreCase(e.getName()));
    }

    // ── 1. Shared Staff ───────────────────────────────────────────────
    private DemoStaff getOrCreateStaff() {
        User coordinator = staff(COORDINATOR_EMAIL, "Event Coordinator", "STAFF", null, "EVENT_COORDINATOR");

        User judge1 = staff("judge1@fpt.edu.vn", "Nguyễn Văn Ronaldo", "STAFF", "INTERNAL", "JUDGE");
        User judge2 = staff("judge2@fpt.edu.vn", "Trần Văn Haaland", "STAFF", "INTERNAL", "JUDGE");
        User judge3 = staff("judge3@fpt.edu.vn", "Pham Van Salah", "STAFF", "INTERNAL", "JUDGE");
        User judge4 = staff("judge4@fpt.edu.vn", "Vu Van Mbappe", "STAFF", "INTERNAL", "JUDGE");
        User judge5 = staff("judge5@fpt.edu.vn", "Đỗ Văn Zidane", "STAFF", "INTERNAL", "JUDGE");
        User judge6 = staff("judge6@fpt.edu.vn", "Bùi Văn Iniesta", "STAFF", "INTERNAL", "JUDGE");
        User judge7 = staff("judge7@fpt.edu.vn", "Ngô Văn Xavi", "STAFF", "INTERNAL", "JUDGE");
        User judge8 = staff("judge8@fpt.edu.vn", "Dương Văn Kaká", "STAFF", "INTERNAL", "JUDGE");

        // Dedicated guest judges so Fall's completion doesn't deactivate Summer's guest judge
        User guestJudgeSummer = staff("guestjudge@gmail.com", "Lê Văn Messi", "STAFF", "GUEST", "JUDGE");
        User guestJudgeFall = staff("guestjudge_fall@gmail.com", "David Beckham", "STAFF", "GUEST", "JUDGE");

        User mentor1 = staff("mentor1@fpt.edu.vn", "Lê Minh Gia Mẫn", "STAFF", null, "MENTOR");
        User mentor2 = staff("mentor2@fpt.edu.vn", "Hồ Văn Mendes", "STAFF", null, "MENTOR");
        User mentor3 = staff("mentor3@fpt.edu.vn", "Phạm Văn Guardiola", "STAFF", null, "MENTOR");
        User mentor4 = staff("mentor4@fpt.edu.vn", "Vũ Văn Klopp", "STAFF", null, "MENTOR");

        // Spare accounts for live test
        if (!userRepo.existsByEmail("leader1@fpt.edu.vn")) {
            fx.user("leader1@fpt.edu.vn", "Hoàng Văn Neymar Jr.", "FPT_STUDENT", null);
        }
        if (!userRepo.existsByEmail("member1@fpt.edu.vn")) {
            fx.user("member1@fpt.edu.vn", "Đinh Văn Kane", "FPT_STUDENT", null);
        }

        return new DemoStaff(
                coordinator,
                List.of(judge1, judge2, judge3, judge4, judge5, judge6, judge7, judge8),
                guestJudgeSummer,
                guestJudgeFall,
                List.of(mentor1, mentor2, mentor3, mentor4)
        );
    }

    private User staff(String email, String name, String userType, String judgeType, String roleName) {
        if (userRepo.existsByEmail(email)) {
            return userRepo.findByEmail(email).orElseThrow();
        }
        User u = fx.user(email, name, userType, judgeType);
        fx.grant(u, roleName, null);
        return u;
    }

    // ── 2. Spring 2026 (S1: OPEN registration & forming teams) ───────
    private void seedSpringS1() {
        HackathonEvent event = fx.event(
                SPRING_EVENT_NAME, "SPRING", YEAR, "OPEN", "RANDOM",
                LocalDateTime.of(2026, 1, 10, 8, 0),
                LocalDateTime.of(2026, 3, 20, 23, 59, 59),
                LocalDateTime.of(2026, 3, 25, 8, 0),
                LocalDateTime.of(2026, 4, 30, 18, 0));

        List<Track> tracks = new ArrayList<>();
        for (String name : TRACKS) {
            tracks.add(fx.track(event, name));
        }
        Round prelim = fx.round(event, 1, "Vòng loại", false, "PENDING",
                LocalDateTime.of(2026, 3, 25, 8, 0),
                LocalDateTime.of(2026, 4, 10, 18, 0),
                LocalDateTime.of(2026, 4, 9, 23, 59, 59),
                TOP_PER_TRACK_ADVANCE);
        Round finalRound = fx.round(event, 2, "Vòng chung kết", true, "PENDING",
                LocalDateTime.of(2026, 4, 15, 8, 0),
                LocalDateTime.of(2026, 4, 30, 18, 0),
                LocalDateTime.of(2026, 4, 28, 23, 59, 59),
                null);

        criteriaFor(event, prelim);
        criteriaFor(event, finalRound);

        // Forming teams (no tracks yet — assigned at SETUP)
        fx.team(event, null, "Arsenal", "APPROVED", nextParticipant(), members(2));
        fx.team(event, null, "Barcelona", "APPROVED", nextParticipant(), members(2));
        fx.team(event, null, "Real Madrid (pending)", "PENDING", nextParticipant(), members(2));
        fx.team(event, null, "Chelsea (solo)", "APPROVED", nextParticipant(), List.of());
        fx.team(event, null, "Juventus (solo)", "APPROVED", nextParticipant(), List.of());
        fx.team(event, null, "Bayern (pair)", "APPROVED", nextParticipant(), members(1));
        for (String teamName : S1_EXTRA_APPROVED_TEAMS) {
            fx.team(event, null, teamName, "APPROVED", nextParticipant(), members(2));
        }
        for (int i = 0; i < 3; i++) {
            nextParticipant();
        }
        log.info("[multi-seed] Spring 2026 (S1) created — OPEN with 15 forming teams + 3 teamless registrants.");
    }

    // ── 3. Summer 2026 (S25: IN_PROGRESS, final round scored) ────────
    private void seedSummerS25(DemoStaff staff) {
        HackathonEvent event = fx.event(
                SUMMER_EVENT_NAME, "SUMMER", YEAR, "IN_PROGRESS", "RANDOM",
                LocalDateTime.of(2026, 5, 5, 8, 0),
                LocalDateTime.of(2026, 6, 15, 23, 59, 59),
                LocalDateTime.of(2026, 6, 20, 8, 0),
                LocalDateTime.of(2026, 8, 25, 18, 0));

        List<Track> tracks = new ArrayList<>();
        for (String name : TRACKS) {
            tracks.add(fx.track(event, name));
        }
        Round prelim = fx.round(event, 1, "Vòng loại", false, "FINALIZED",
                LocalDateTime.of(2026, 6, 20, 8, 0),
                LocalDateTime.of(2026, 7, 5, 18, 0),
                LocalDateTime.of(2026, 7, 4, 23, 59, 59),
                TOP_PER_TRACK_ADVANCE);
        Round finalRound = fx.round(event, 2, "Vòng chung kết", true, "ACTIVE",
                LocalDateTime.of(2026, 7, 10, 8, 0),
                LocalDateTime.of(2026, 8, 20, 18, 0),
                LocalDateTime.of(2026, 8, 19, 23, 59, 59),
                null);

        List<ScoringCriteria> prelimCriteria = criteriaFor(event, prelim);
        List<ScoringCriteria> finalCriteria = criteriaFor(event, finalRound);

        for (int t = 0; t < tracks.size(); t++) {
            fx.assignMentor(staff.mentors().get(t), tracks.get(t));
        }

        List<Slot> slots = createTeamsAndSlots(event, tracks);

        Map<Integer, List<User>> prelimJudgesByTrack = assignPrelimJudges(tracks, prelim, staff.judges());
        fx.assignJudge(staff.judges().get(0), finalRound, null);
        fx.assignJudge(staff.judges().get(1), finalRound, null);
        fx.assignJudge(staff.guestJudgeSummer(), finalRound, null);

        List<Submission> prelimSubs = new ArrayList<>();
        for (Slot s : slots) {
            prelimSubs.add(fx.submission(s.team, prelim, s.leader));
        }
        writeScoresByTrack(prelimSubs, slots, prelimCriteria, prelimJudgesByTrack);

        List<Slot> advancing = computeAdvancingTeams(tracks, slots, prelim, prelimCriteria, prelimJudgesByTrack, staff.coordinator());

        List<Submission> finalSubs = new ArrayList<>();
        for (Slot s : advancing) {
            finalSubs.add(fx.submission(s.team, finalRound, s.leader));
        }
        List<User> finalJudges = List.of(staff.judges().get(0), staff.judges().get(1), staff.guestJudgeSummer());
        writeScores(finalSubs, advancing, finalCriteria, finalJudges);

        fx.expiredTimer(prelim, "CONTEST", prelim.getStartTime(), prelim.getSubmissionDeadline());
        fx.expiredTimer(prelim, "JUDGING", prelim.getSubmissionDeadline(), prelim.getEndTime());
        fx.expiredTimer(finalRound, "CONTEST", finalRound.getStartTime(), finalRound.getSubmissionDeadline());
        fx.expiredTimer(finalRound, "JUDGING", finalRound.getSubmissionDeadline(), finalRound.getEndTime());

        log.info("[multi-seed] Summer 2026 (S25) created — IN_PROGRESS: prelim FINALIZED, {} finalists scored in ACTIVE final round.",
                advancing.size());
    }

    // ── 4. Fall 2026 (S3: COMPLETED, published results & prizes) ─────
    private void seedFallS3(DemoStaff staff) {
        HackathonEvent event = fx.event(
                FALL_EVENT_NAME, "FALL", YEAR, "IN_PROGRESS", "RANDOM",
                LocalDateTime.of(2026, 9, 1, 8, 0),
                LocalDateTime.of(2026, 10, 1, 23, 59, 59),
                LocalDateTime.of(2026, 10, 5, 8, 0),
                LocalDateTime.of(2026, 11, 20, 18, 0));

        List<Track> tracks = new ArrayList<>();
        for (String name : TRACKS) {
            tracks.add(fx.track(event, name));
        }
        Round prelim = fx.round(event, 1, "Vòng loại", false, "FINALIZED",
                LocalDateTime.of(2026, 10, 5, 8, 0),
                LocalDateTime.of(2026, 10, 20, 18, 0),
                LocalDateTime.of(2026, 10, 19, 23, 59, 59),
                TOP_PER_TRACK_ADVANCE);
        Round finalRound = fx.round(event, 2, "Vòng chung kết", true, "ACTIVE",
                LocalDateTime.of(2026, 10, 25, 8, 0),
                LocalDateTime.of(2026, 11, 15, 18, 0),
                LocalDateTime.of(2026, 11, 14, 23, 59, 59),
                null);

        List<ScoringCriteria> prelimCriteria = criteriaFor(event, prelim);
        List<ScoringCriteria> finalCriteria = criteriaFor(event, finalRound);

        for (int t = 0; t < tracks.size(); t++) {
            fx.assignMentor(staff.mentors().get(t), tracks.get(t));
        }

        List<Slot> slots = createTeamsAndSlots(event, tracks);

        Map<Integer, List<User>> prelimJudgesByTrack = assignPrelimJudges(tracks, prelim, staff.judges());
        fx.assignJudge(staff.judges().get(0), finalRound, null);
        fx.assignJudge(staff.judges().get(1), finalRound, null);
        fx.assignJudge(staff.guestJudgeFall(), finalRound, null);

        List<Submission> prelimSubs = new ArrayList<>();
        for (Slot s : slots) {
            prelimSubs.add(fx.submission(s.team, prelim, s.leader));
        }
        writeScoresByTrack(prelimSubs, slots, prelimCriteria, prelimJudgesByTrack);

        List<Slot> advancing = computeAdvancingTeams(tracks, slots, prelim, prelimCriteria, prelimJudgesByTrack, staff.coordinator());

        List<Submission> finalSubs = new ArrayList<>();
        for (Slot s : advancing) {
            finalSubs.add(fx.submission(s.team, finalRound, s.leader));
        }
        List<User> finalJudges = List.of(staff.judges().get(0), staff.judges().get(1), staff.guestJudgeFall());
        writeScores(finalSubs, advancing, finalCriteria, finalJudges);

        fx.expiredTimer(prelim, "CONTEST", prelim.getStartTime(), prelim.getSubmissionDeadline());
        fx.expiredTimer(prelim, "JUDGING", prelim.getSubmissionDeadline(), prelim.getEndTime());
        fx.expiredTimer(finalRound, "CONTEST", finalRound.getStartTime(), finalRound.getSubmissionDeadline());
        fx.expiredTimer(finalRound, "JUDGING", finalRound.getSubmissionDeadline(), finalRound.getEndTime());

        // Replay production workflow: finalize -> publish -> autoGenerate prizes -> announce -> complete
        int finalResultCount = roundResultService
                .finalizeRound(event.getEventId(), finalRound.getRoundId(), staff.coordinator().getUserId())
                .size();
        roundResultService.publishResults(event.getEventId(), finalRound.getRoundId());

        AutoGeneratePrizesRequest prizeRequest = new AutoGeneratePrizesRequest();
        prizeRequest.setTopN(3);
        int prizeCount = prizeService.autoGenerate(event.getEventId(), prizeRequest).size();
        prizeService.announce(event.getEventId(), staff.coordinator().getUserId());

        hackathonEventService.completeEvent(event.getEventId());

        seedSystemLog(staff.coordinator(), staff.judges().get(0), staff.judges().get(1),
                staff.guestJudgeFall(), staff.mentors().get(0), staff.mentors().get(1));

        log.info("[multi-seed] Fall 2026 (S3) created — COMPLETED: {} teams, {} results, {} prizes.",
                slots.size(), finalResultCount, prizeCount);
    }

    // ── Helper builders ──────────────────────────────────────────────
    private List<Slot> createTeamsAndSlots(HackathonEvent event, List<Track> tracks) {
        List<Slot> slots = new ArrayList<>();
        int numTracks = tracks.size();
        int totalTeams = 0;
        for (int c : TEAMS_PER_TRACK) totalTeams += c;
        maxStrength = totalTeams;
        for (int t = 0; t < numTracks; t++) {
            Track track = tracks.get(t);
            for (int seed = 0; seed < TEAMS_PER_TRACK[t]; seed++) {
                User leader = nextParticipant();
                String teamName = CLUBS[slots.size() % CLUBS.length];
                Team team = fx.team(event, track, teamName, "APPROVED", leader, members(2));
                int strength = totalTeams - (seed * numTracks + t);
                slots.add(new Slot(team, track, leader, strength));
            }
        }
        return slots;
    }

    private Map<Integer, List<User>> assignPrelimJudges(List<Track> tracks, Round prelim, List<User> prelimJudgePool) {
        Map<Integer, List<User>> prelimJudgesByTrack = new LinkedHashMap<>();
        for (int t = 0; t < tracks.size(); t++) {
            Track track = tracks.get(t);
            int panelStart = t * PRELIM_JUDGES_PER_TRACK;
            List<User> panel = List.copyOf(prelimJudgePool.subList(
                    panelStart, panelStart + PRELIM_JUDGES_PER_TRACK));
            panel.forEach(judge -> fx.assignJudge(judge, prelim, track));
            prelimJudgesByTrack.put(track.getTrackId(), panel);
        }
        return prelimJudgesByTrack;
    }

    private List<Slot> computeAdvancingTeams(List<Track> tracks, List<Slot> slots, Round prelim,
                                             List<ScoringCriteria> prelimCriteria,
                                             Map<Integer, List<User>> prelimJudgesByTrack,
                                             User coordinator) {
        List<Slot> advancing = new ArrayList<>();
        for (Track track : tracks) {
            List<Slot> inTrack = slots.stream()
                    .filter(s -> track.getTrackId().equals(s.track().getTrackId()))
                    .sorted(Comparator.comparingDouble((Slot s) -> total(s, prelimCriteria,
                            judgesForTrack(s.track(), prelimJudgesByTrack).size())).reversed())
                    .toList();
            for (int r = 0; r < inTrack.size(); r++) {
                Slot s = inTrack.get(r);
                fx.result(s.team, prelim, total(s, prelimCriteria,
                        judgesForTrack(s.track(), prelimJudgesByTrack).size()), r + 1, coordinator);
                if (r < TOP_PER_TRACK_ADVANCE) advancing.add(s);
            }
        }
        return advancing;
    }

    private void seedSystemLog(User coordinator, User judge1, User judge2, User guestJudge,
                               User mentor1, User mentor2) {
        User admin = fx.adminActor();
        LocalDateTime now = LocalDateTime.now();

        fx.systemLog(admin, "CREATE_USER", "Created staff account " + coordinator.getEmail() + ".", now.minusDays(70));
        fx.systemLog(admin, "GRANT_ROLE", "Granted EVENT_COORDINATOR to " + coordinator.getFullName() + " (system-wide).", now.minusDays(70));
        fx.systemLog(admin, "CREATE_USER", "Created staff account " + judge1.getEmail() + ".", now.minusDays(69));
        fx.systemLog(admin, "GRANT_ROLE", "Granted JUDGE to " + judge1.getFullName() + " (system-wide).", now.minusDays(69));
        fx.systemLog(admin, "CREATE_USER", "Created staff account " + judge2.getEmail() + ".", now.minusDays(69));
        fx.systemLog(admin, "GRANT_ROLE", "Granted JUDGE to " + judge2.getFullName() + " (system-wide).", now.minusDays(69));
        fx.systemLog(admin, "CREATE_USER", "Created guest judge account " + guestJudge.getEmail() + ".", now.minusDays(68));
        fx.systemLog(admin, "GRANT_ROLE", "Granted JUDGE to " + guestJudge.getFullName() + " (system-wide).", now.minusDays(68));
        fx.systemLog(admin, "GRANT_ROLE", "Granted MENTOR to " + mentor1.getFullName() + " (system-wide).", now.minusDays(68));
        fx.systemLog(admin, "GRANT_ROLE", "Granted MENTOR to " + mentor2.getFullName() + " (system-wide).", now.minusDays(68));
        fx.systemLog(coordinator, "LOGIN_FAILED", "Failed login attempt for " + coordinator.getEmail() + " (wrong password).", now.minusDays(40));
        fx.systemLog(admin, "RESET_PASSWORD", "Reset password for " + guestJudge.getEmail() + " after a lockout request.", now.minusDays(35));
        fx.systemLog(admin, "COMPLETE_EVENT", "Marked \"" + FALL_EVENT_NAME + "\" as COMPLETED (IN_PROGRESS → COMPLETED).", now);
    }

    private void writeScoresByTrack(List<Submission> subs, List<Slot> slots,
                                    List<ScoringCriteria> criteria,
                                    Map<Integer, List<User>> judgesByTrack) {
        for (int k = 0; k < subs.size(); k++) {
            Slot slot = slots.get(k);
            Submission sub = subs.get(k);
            List<User> judges = judgesForTrack(slot.track(), judgesByTrack);
            for (int c = 0; c < criteria.size(); c++) {
                for (int j = 0; j < judges.size(); j++) {
                    fx.score(sub, judges.get(j), criteria.get(c), prelimValue(slot.strength, j));
                }
            }
        }
    }

    private List<User> judgesForTrack(Track track, Map<Integer, List<User>> judgesByTrack) {
        List<User> judges = judgesByTrack.get(track.getTrackId());
        if (judges == null || judges.isEmpty()) {
            throw new IllegalStateException("No prelim judge seeded for track " + track.getName() + ".");
        }
        return judges;
    }

    private void writeScores(List<Submission> subs, List<Slot> slots,
                             List<ScoringCriteria> criteria, List<User> judges) {
        for (int k = 0; k < subs.size(); k++) {
            Slot slot = slots.get(k);
            Submission sub = subs.get(k);
            for (int c = 0; c < criteria.size(); c++) {
                for (int j = 0; j < judges.size(); j++) {
                    fx.score(sub, judges.get(j), criteria.get(c), value(slot.strength, c, j));
                }
            }
        }
    }

    private double prelimValue(int strength, int judgeIdx) {
        int targetIndex = (strength - 1) * PRELIM_JUDGES_PER_TRACK + judgeIdx;
        if (targetIndex < 0 || targetIndex >= PRELIM_EVALUATION_TARGETS.length) {
            throw new IllegalArgumentException("No prelim score target for strength " + strength
                    + " and judge index " + judgeIdx + ".");
        }
        return PRELIM_EVALUATION_TARGETS[targetIndex] / 10.0;
    }

    private double value(int strength, int criteriaIdx, int judgeIdx) {
        double strength01 = normalizedStrength(strength);
        double base = 4.0 + 5.5 * strength01;
        double judgeJitter = switch (judgeIdx % 4) {
            case 0 -> -0.35;
            case 1 -> 0.35;
            case 2 -> -0.55;
            default -> 0.15;
        };
        double criteriaAdj = criteriaIdx % 2 == 0 ? 0.2 : -0.1;
        double v = base + judgeJitter + criteriaAdj;
        v = Math.max(0.0, Math.min(MAX_SCORE, v));
        return Math.round(v * 100.0) / 100.0;
    }

    private double total(Slot slot, List<ScoringCriteria> criteria, int judgeCount) {
        double weightedTotal = 0.0;
        double weightSum = 0.0;
        for (int c = 0; c < criteria.size(); c++) {
            double sum = 0.0;
            for (int j = 0; j < judgeCount; j++) {
                sum += prelimValue(slot.strength, j);
            }
            double avg = sum / judgeCount;
            double weight = criteria.get(c).getWeight().doubleValue();
            weightedTotal += (avg / MAX_SCORE) * weight;
            weightSum += weight;
        }
        double normalized = weightSum == 0.0 ? 0.0 : 100.0 * weightedTotal / weightSum;
        return Math.round(normalized * 100.0) / 100.0;
    }

    private double normalizedStrength(int strength) {
        return maxStrength <= 1 ? 1.0 : (double) (strength - 1) / (maxStrength - 1);
    }

    private List<ScoringCriteria> criteriaFor(HackathonEvent event, Round round) {
        List<ScoringCriteria> list = new ArrayList<>();
        for (int i = 0; i < CRITERIA.length; i++) {
            list.add(fx.criteria(event, round, CRITERIA[i][0],
                    Double.parseDouble(CRITERIA[i][1]), MAX_SCORE, i + 1));
        }
        return list;
    }

    private User nextParticipant() {
        participantSeq++;
        String email = "p" + participantSeq + "@fpt.edu.vn";
        while (userRepo.existsByEmail(email)) {
            participantSeq++;
            email = "p" + participantSeq + "@fpt.edu.vn";
        }
        String name = PLAYERS[(participantSeq - 1) % PLAYERS.length];
        String type = participantSeq % 3 == 0 ? "EXTERNAL_STUDENT" : "FPT_STUDENT";
        return fx.user(email, name, type, null);
    }

    private List<User> members(int count) {
        List<User> list = new ArrayList<>();
        for (int i = 0; i < count; i++) {
            list.add(nextParticipant());
        }
        return list;
    }

    private record Slot(Team team, Track track, User leader, int strength) {
    }
}
