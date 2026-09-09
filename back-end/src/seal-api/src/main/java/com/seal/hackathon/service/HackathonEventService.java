package com.seal.hackathon.service;

import com.seal.hackathon.dto.request.CreateEventRequest;
import com.seal.hackathon.dto.request.UpdateEventRequest;
import com.seal.hackathon.dto.response.HackathonEventResponse;
import com.seal.hackathon.entity.HackathonEvent;
import com.seal.hackathon.entity.JudgeAssignment;
import com.seal.hackathon.entity.Team;
import com.seal.hackathon.entity.TeamEventEntry;
import com.seal.hackathon.entity.TeamMember;
import com.seal.hackathon.entity.Track;
import com.seal.hackathon.entity.User;
import com.seal.hackathon.exception.BadRequestException;
import com.seal.hackathon.exception.ResourceNotFoundException;
import com.seal.hackathon.repository.HackathonEventRepository;
import com.seal.hackathon.repository.JudgeAssignmentRepository;
import com.seal.hackathon.repository.TeamEventEntryRepository;
import com.seal.hackathon.repository.TeamMemberRepository;
import com.seal.hackathon.repository.TeamRepository;
import com.seal.hackathon.repository.TrackRepository;
import com.seal.hackathon.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class HackathonEventService {

    private final HackathonEventRepository hackathonEventRepository;
    private final TrackRepository trackRepository;
    private final TeamRepository teamRepository;
    private final TeamEventEntryRepository teamEventEntryRepository;
    private final TeamMemberRepository teamMemberRepository;
    private final UserRepository userRepository;
    private final JudgeAssignmentRepository judgeAssignmentRepository;
    private final ParticipantHistorySnapshotService participantHistorySnapshotService;
    private final AuditLogService auditLogService;

    private static final Set<String> VALID_STATUSES =
            Set.of("DRAFT", "OPEN", "SETUP", "IN_PROGRESS", "COMPLETED", "CANCELLED");

    private static final Set<String> VALID_SEASONS =
            Set.of("SPRING", "SUMMER", "FALL");

    private static final Set<String> VALID_TRACK_MODES =
            Set.of("SELF_SELECT", "RANDOM");

    private static final String CANCELLED_STATUS = "CANCELLED";

    // A track needs at least this many approved teams to be a valid competition
    // track. Mirrors the frontend MIN_TEAMS_PER_TRACK (trackStats.ts).
    private static final int MIN_TEAMS_PER_TRACK = 2;

    // Allowed status transitions — backend is the source of truth (the FE buttons
    // only mirror this). The Coordinator-operable states DRAFT/OPEN/SETUP/IN_PROGRESS
    // form a line that may be walked BOTH ways one step at a time — forward to
    // advance, backward to roll back: DRAFT↔OPEN↔SETUP↔IN_PROGRESS. CANCELLED from any
    // non-terminal state; a cancelled event may be reopened to DRAFT.
    //
    // SETUP = registration closed; coordinator locks/draws teams into tracks before
    // competition starts. Rolling back into SETUP (IN_PROGRESS→SETUP) re-enters the
    // setup phase; the roster was already frozen when registration closed.
    // NOTE: IN_PROGRESS -> COMPLETED is intentionally NOT in this map. Completing
    // an event is a System-Admin-only action handled by the dedicated
    // completeEvent()/POST /complete path, so the generic PUT (reachable by a
    // Coordinator) can never complete an event (it would 400 here).
    private static final Map<String, Set<String>> TRANSITIONS = Map.of(
            "DRAFT",       Set.of("OPEN", "CANCELLED"),
            "OPEN",        Set.of("SETUP", "DRAFT", "CANCELLED"),
            "SETUP",       Set.of("IN_PROGRESS", "OPEN", "CANCELLED"),
            "IN_PROGRESS", Set.of("SETUP", "CANCELLED"),
            "COMPLETED",   Set.of(),
            "CANCELLED",   Set.of("DRAFT")
    );

    private static final Map<String, Integer> SEASON_CHRONO_ORDER = Map.of(
            "SPRING", 1,
            "SUMMER", 2,
            "FALL", 3
    );

    @Transactional(readOnly = true)
    public List<HackathonEventResponse> getAllHackathonEvents() {
        return hackathonEventRepository.findAll().stream()
                .sorted(Comparator
                        .comparing((HackathonEvent e) -> e.getYear() != null ? e.getYear() : 0, Comparator.reverseOrder())
                        .thenComparing(e -> SEASON_CHRONO_ORDER.getOrDefault(
                                e.getSeason() != null ? e.getSeason().toUpperCase() : "", 0), Comparator.reverseOrder())
                        .thenComparing(HackathonEvent::getStartDate, Comparator.nullsLast(Comparator.reverseOrder()))
                        .thenComparing(HackathonEvent::getEventId, Comparator.nullsLast(Comparator.reverseOrder())))
                .map(this::mapToResponse)
                .collect(Collectors.toList());
    }

    @Transactional(readOnly = true)
    public HackathonEventResponse getEventById(Integer eventId) {
        HackathonEvent event = hackathonEventRepository.findById(eventId)
                .orElseThrow(() -> new ResourceNotFoundException("Event not found: " + eventId));
        return mapToResponse(event);
    }

    @Transactional
    public HackathonEventResponse createEvent(CreateEventRequest request, Integer actorUserId) {
        String name = normalizeEventName(request.getName());
        String season = normalizeSeason(request.getSeason());
        Integer year = validateYear(request.getYear());
        validateCompleteEventSchedule(season, year,
                request.getRegistrationStart(), request.getRegistrationEnd(),
                request.getStartDate(), request.getEndDate());
        requireDatesNotBeforeToday(true,
                request.getRegistrationStart(), request.getRegistrationEnd(),
                request.getStartDate(), request.getEndDate());

        String status = (request.getStatus() != null && !request.getStatus().isBlank())
                ? request.getStatus().toUpperCase()
                : "DRAFT";
        requireValidStatus(status);

        String trackMode = (request.getTrackSelectionMode() != null && !request.getTrackSelectionMode().isBlank())
                ? request.getTrackSelectionMode().toUpperCase()
                : "SELF_SELECT";
        requireValidTrackMode(trackMode);
        validateUniqueActiveSeasonEvent(year, season, status, null);
        validateNoOverlappingActiveEvent(request.getStartDate(), request.getEndDate(), status, null);

        HackathonEvent event = HackathonEvent.builder()
                .name(name)
                .season(season)
                .year(year)
                .description(request.getDescription())
                .topic(request.getTopic())
                .registrationStart(request.getRegistrationStart())
                .registrationEnd(request.getRegistrationEnd())
                .startDate(request.getStartDate())
                .endDate(request.getEndDate())
                .status(status)
                .trackSelectionMode(trackMode)
                .build();

        event = hackathonEventRepository.save(event);
        auditLogService.record(actorUserId, "CREATE_EVENT", "EVENT", event.getEventId(), null,
                Map.of("name", event.getName(), "season", event.getSeason(),
                        "year", event.getYear(), "status", event.getStatus()));
        return mapToResponse(event);
    }

    @Transactional
    public HackathonEventResponse updateEvent(Integer eventId, UpdateEventRequest request) {
        HackathonEvent event = hackathonEventRepository.findById(eventId)
                .orElseThrow(() -> new ResourceNotFoundException("Event not found: " + eventId));

        String effectiveSeason = event.getSeason();
        Integer effectiveYear = event.getYear();
        LocalDateTime effectiveRegistrationStart = event.getRegistrationStart();
        LocalDateTime effectiveRegistrationEnd = event.getRegistrationEnd();
        LocalDateTime effectiveStartDate = event.getStartDate();
        LocalDateTime effectiveEndDate = event.getEndDate();
        String effectiveStatus = event.getStatus();
        String effectiveTrackMode = event.getTrackSelectionMode();

        if (request.getName() != null) {
            event.setName(normalizeEventName(request.getName()));
        }
        if (request.getSeason() != null) {
            effectiveSeason = normalizeSeason(request.getSeason());
        }
        if (request.getYear() != null) {
            effectiveYear = validateYear(request.getYear());
        }
        if (request.getDescription() != null) {
            event.setDescription(request.getDescription());
        }
        if (request.getTopic() != null) {
            event.setTopic(request.getTopic());
        }
        if (request.getRegistrationStart() != null) {
            effectiveRegistrationStart = request.getRegistrationStart();
        }
        if (request.getRegistrationEnd() != null) {
            effectiveRegistrationEnd = request.getRegistrationEnd();
        }
        if (request.getStartDate() != null) {
            effectiveStartDate = request.getStartDate();
        }
        if (request.getEndDate() != null) {
            effectiveEndDate = request.getEndDate();
        }
        if (request.getTrackSelectionMode() != null && !request.getTrackSelectionMode().isBlank()) {
            String newMode = request.getTrackSelectionMode().toUpperCase();
            requireValidTrackMode(newMode);
            // Mode decides how SETUP behaves, so it can only change before SETUP.
            if (!"DRAFT".equalsIgnoreCase(event.getStatus()) && !"OPEN".equalsIgnoreCase(event.getStatus())) {
                throw new BadRequestException(
                        "Track selection mode can only be changed while the event is in DRAFT or OPEN.");
            }
            effectiveTrackMode = newMode;
        }

        if (request.getStatus() != null && !request.getStatus().isBlank()) {
            String newStatus = request.getStatus().toUpperCase();
            requireValidStatus(newStatus);
            requireValidTransition(event.getStatus(), newStatus);
            boolean enteringSetup = "SETUP".equals(newStatus) && !"SETUP".equalsIgnoreCase(event.getStatus());
            // Starting the event (SETUP -> IN_PROGRESS) is gated: every track must
            // have at least MIN_TEAMS_PER_TRACK approved teams and no approved team
            // may be left unassigned. Validate BEFORE mutating status so a failed
            // gate changes nothing.
            boolean startingEvent = "IN_PROGRESS".equals(newStatus) && "SETUP".equalsIgnoreCase(event.getStatus());
            if (startingEvent) {
                requireSetupComplete(event);
            }
            effectiveStatus = newStatus;
            // Closing registration freezes the team count and computes per-track slots.
            if (enteringSetup) {
                requireAllTeamsResolved(event);
                computeTrackCapacities(event);
            }
        }

        // Validate the effective date ordering after applying any patches.
        requireValidDates(effectiveRegistrationStart, effectiveRegistrationEnd,
                effectiveStartDate, effectiveEndDate);

        boolean scheduleTouched = request.getSeason() != null || request.getYear() != null
                || request.getRegistrationStart() != null || request.getRegistrationEnd() != null
                || request.getStartDate() != null || request.getEndDate() != null;
        boolean reactivatingCancelled = CANCELLED_STATUS.equalsIgnoreCase(event.getStatus())
                && !CANCELLED_STATUS.equalsIgnoreCase(effectiveStatus);
        if (scheduleTouched || reactivatingCancelled) {
            validateCompleteEventSchedule(effectiveSeason, effectiveYear,
                    effectiveRegistrationStart, effectiveRegistrationEnd,
                    effectiveStartDate, effectiveEndDate);
        }
        if (scheduleTouched) {
            requireRequestedDatesNotBeforeToday(request);
        }

        boolean uniquenessOrOverlapMayChange = request.getSeason() != null || request.getYear() != null
                || request.getStartDate() != null || request.getEndDate() != null
                || reactivatingCancelled;
        if (uniquenessOrOverlapMayChange) {
            validateUniqueActiveSeasonEvent(effectiveYear, effectiveSeason, effectiveStatus, eventId);
            validateNoOverlappingActiveEvent(effectiveStartDate, effectiveEndDate, effectiveStatus, eventId);
        }

        event.setSeason(effectiveSeason);
        event.setYear(effectiveYear);
        event.setRegistrationStart(effectiveRegistrationStart);
        event.setRegistrationEnd(effectiveRegistrationEnd);
        event.setStartDate(effectiveStartDate);
        event.setEndDate(effectiveEndDate);
        event.setTrackSelectionMode(effectiveTrackMode);
        event.setStatus(effectiveStatus);

        event = hackathonEventRepository.save(event);
        return mapToResponse(event);
    }

    /**
     * Completes a running event (IN_PROGRESS -> COMPLETED). System-Admin-only
     * dedicated path — deliberately separate from {@link #updateEvent} (whose
     * TRANSITIONS map no longer allows IN_PROGRESS -> COMPLETED) so a
     * Coordinator's generic PUT can never complete an event.
     */
    @Transactional
    public HackathonEventResponse completeEvent(Integer eventId) {
        HackathonEvent event = hackathonEventRepository.findById(eventId)
                .orElseThrow(() -> new ResourceNotFoundException("Event not found: " + eventId));
        if (!"IN_PROGRESS".equalsIgnoreCase(event.getStatus())) {
            throw new BadRequestException("Only an IN_PROGRESS event can be completed.");
        }
        event.setStatus("COMPLETED");
        event = hackathonEventRepository.save(event);
        lockCompletedEventParticipantsReadOnly(event.getEventId());
        // Freeze every current participant's result for this event — the
        // "stayed till the end" half of participant history; departures
        // before this point are snapshotted separately in TeamMembershipService.
        participantHistorySnapshotService.snapshotEventCompletion(event.getEventId());
        return mapToResponse(event);
    }

    /**
     * Reopens a COMPLETED event back to IN_PROGRESS. This is the System Admin's
     * dedicated path — deliberately separate from {@link #updateEvent} because
     * the normal TRANSITIONS map blocks COMPLETED -> * (so a Coordinator's PUT
     * can never reopen). Only callable from the admin-guarded /reopen endpoint
     * (and the reopen-request approval flow).
     */
    @Transactional
    public HackathonEventResponse reopenEvent(Integer eventId) {
        HackathonEvent event = hackathonEventRepository.findById(eventId)
                .orElseThrow(() -> new ResourceNotFoundException("Event not found: " + eventId));
        if (!"COMPLETED".equalsIgnoreCase(event.getStatus())) {
            throw new BadRequestException("Only a COMPLETED event can be reopened.");
        }
        event.setStatus("IN_PROGRESS");
        event = hackathonEventRepository.save(event);
        // Completing the event flipped its participants to inactive; reopening must
        // flip them back so the event's leaders/members can act again (otherwise the
        // team console shows but every write is blocked as inactive).
        reactivateEventParticipants(event.getEventId());
        return mapToResponse(event);
    }

    // ── Lifecycle / validation helpers ───────────────────────────────

    private void requireValidStatus(String status) {
        if (!VALID_STATUSES.contains(status)) {
            throw new BadRequestException("Invalid status '" + status
                    + "'. Must be DRAFT, OPEN, SETUP, IN_PROGRESS, COMPLETED or CANCELLED.");
        }
    }

    /**
     * Registration must be fully triaged before entering SETUP: every team is resolved
     * (APPROVED or REJECTED/DISQUALIFIED), none left PENDING. Otherwise the frozen roster
     * and track draw would run on a set the coordinator has not finished reviewing.
     */
    private void requireAllTeamsResolved(HackathonEvent event) {
        long pending = teamEventEntryRepository.countByEvent_EventIdAndStatus(event.getEventId(), "PENDING");
        if (pending > 0) {
            throw new BadRequestException("Cannot move to SETUP while " + pending
                    + " team(s) are still pending approval — approve or reject them first.");
        }
    }

    private void lockCompletedEventParticipantsReadOnly(Integer completedEventId) {
        List<TeamEventEntry> entries = teamEventEntryRepository.findAllByEvent_EventId(completedEventId);

        List<User> students = entries.stream()
                .flatMap(entry -> teamMemberRepository.findByTeam_TeamId(entry.getTeam().getTeamId()).stream())
                .map(TeamMember::getUser)
                .filter(this::isStudent)
                .filter(user -> !hasNonCompletedMembership(user, completedEventId))
                .distinct()
                .collect(Collectors.toList());
        students.forEach(user -> user.setIsActive(false));
        userRepository.saveAll(students);

        // Teams mirror User's isActive: no longer "in a running competition" once
        // the event completes. A DISQUALIFIED entry already flipped this earlier —
        // leave it false either way, it's a no-op to re-set it. Same guard as the
        // student loop above: a team with a live entry in another non-completed
        // event (e.g. next season already opened before this one was marked
        // Complete) must stay active.
        List<Team> teams = entries.stream()
                .map(TeamEventEntry::getTeam)
                .distinct()
                .filter(team -> !hasNonCompletedEntryElsewhere(team, completedEventId))
                .collect(Collectors.toList());
        teams.forEach(team -> team.setIsActive(false));
        teamRepository.saveAll(teams);

        // Guest judges are per-event temporary accounts — they too leave the
        // "in a running competition" state when the event ends. (Internal judges
        // are permanent staff and stay active.)
        List<User> guestJudges = guestJudgesOf(completedEventId);
        guestJudges.forEach(user -> user.setIsActive(false));
        userRepository.saveAll(guestJudges);
    }

    // Reverse of the completion lock: reactivate every student, guest judge, and
    // team tied to this (reopened) event so they resume as active participants.
    private void reactivateEventParticipants(Integer eventId) {
        List<TeamEventEntry> entries = teamEventEntryRepository.findAllByEvent_EventId(eventId);

        List<User> students = entries.stream()
                .flatMap(entry -> teamMemberRepository.findByTeam_TeamId(entry.getTeam().getTeamId()).stream())
                .map(TeamMember::getUser)
                .filter(this::isStudent)
                .distinct()
                .collect(Collectors.toList());
        students.forEach(user -> user.setIsActive(true));
        userRepository.saveAll(students);

        // A disqualified team must not be resurrected just because the event
        // reopened — DISQUALIFIED is a standalone, permanent-for-the-season state.
        List<Team> teams = entries.stream()
                .filter(entry -> !"DISQUALIFIED".equalsIgnoreCase(entry.getStatus()))
                .map(TeamEventEntry::getTeam)
                .distinct()
                .collect(Collectors.toList());
        teams.forEach(team -> team.setIsActive(true));
        teamRepository.saveAll(teams);

        List<User> guestJudges = guestJudgesOf(eventId);
        guestJudges.forEach(user -> user.setIsActive(true));
        userRepository.saveAll(guestJudges);
    }

    // Guest (not internal) judges assigned to any round of the event.
    private List<User> guestJudgesOf(Integer eventId) {
        return judgeAssignmentRepository.findActiveByEvent(eventId).stream()
                .map(JudgeAssignment::getJudge)
                .filter(u -> "GUEST".equalsIgnoreCase(u.getJudgeType()))
                .distinct()
                .collect(Collectors.toList());
    }

    private boolean isStudent(User user) {
        return "FPT_STUDENT".equalsIgnoreCase(user.getUserType())
                || "EXTERNAL_STUDENT".equalsIgnoreCase(user.getUserType());
    }

    private boolean hasNonCompletedMembership(User user, Integer completedEventId) {
        return teamMemberRepository.findByUser_UserIdOrderByIdDesc(user.getUserId()).stream()
                .flatMap(member -> teamEventEntryRepository
                        .findAllByTeam_TeamId(member.getTeam().getTeamId()).stream())
                .map(TeamEventEntry::getEvent)
                .filter(event -> !event.getEventId().equals(completedEventId))
                .anyMatch(event -> !"COMPLETED".equalsIgnoreCase(event.getStatus()));
    }

    // Team-level counterpart of hasNonCompletedMembership: true if this team has a
    // season entry in some other event that isn't COMPLETED yet (status transitions
    // are manual, so a new season can already be open before the old one is marked
    // Complete), meaning the team must not be deactivated by that other event.
    private boolean hasNonCompletedEntryElsewhere(Team team, Integer completedEventId) {
        return teamEventEntryRepository.findAllByTeam_TeamId(team.getTeamId()).stream()
                .map(TeamEventEntry::getEvent)
                .filter(event -> !event.getEventId().equals(completedEventId))
                .anyMatch(event -> !"COMPLETED".equalsIgnoreCase(event.getStatus()));
    }

    private void requireValidTrackMode(String mode) {
        if (!VALID_TRACK_MODES.contains(mode)) {
            throw new BadRequestException("Invalid track selection mode '" + mode
                    + "'. Must be SELF_SELECT or RANDOM.");
        }
    }

    /**
     * Freezes the roster on entering SETUP and assigns each track an even slot
     * count: floor = approvedTeams / trackCount, remainder r distributed one extra
     * to the first r tracks. Total slots == approved team count, so when every team
     * lands a slot the per-track counts differ by at most 1.
     */
    private void computeTrackCapacities(HackathonEvent event) {
        List<Track> tracks = trackRepository.findAllByEvent_EventId(event.getEventId());
        if (tracks.isEmpty()) {
            throw new BadRequestException(
                    "Add at least one track before closing registration (moving to SETUP).");
        }
        int approved = teamEventEntryRepository
                .findAllByEvent_EventIdAndStatus(event.getEventId(), "APPROVED").size();
        int n = tracks.size();
        int floor = approved / n;
        int remainder = approved % n;
        for (int i = 0; i < n; i++) {
            tracks.get(i).setCapacity(i < remainder ? floor + 1 : floor);
        }
        trackRepository.saveAll(tracks);
    }

    /**
     * Recompute per-track SETUP capacities after the roster changed mid-SETUP — e.g.
     * leftover grouping created/merged teams, so the count frozen on SETUP entry is
     * stale. Must run before the track draw so slots reflect the final team count.
     * No-op when the event has no tracks yet. SETUP-only.
     */
    @Transactional
    public void recomputeSetupTrackCapacities(Integer eventId) {
        HackathonEvent event = hackathonEventRepository.findById(eventId)
                .orElseThrow(() -> new ResourceNotFoundException("Event not found: " + eventId));
        if (!"SETUP".equalsIgnoreCase(event.getStatus())) {
            throw new BadRequestException("Track capacities are only recomputed during SETUP.");
        }
        if (trackRepository.findAllByEvent_EventId(eventId).isEmpty()) {
            return;
        }
        computeTrackCapacities(event);
    }

    /**
     * Gate for leaving SETUP (SETUP -> IN_PROGRESS). The event can only start when
     * every track has at least {@link #MIN_TEAMS_PER_TRACK} approved teams and no
     * approved team is left unassigned. Throws a BadRequest listing every problem so
     * the coordinator knows exactly what to fix (mirrors the FE canCompleteSetup).
     */
    private void requireSetupComplete(HackathonEvent event) {
        List<Track> tracks = trackRepository.findAllByEvent_EventId(event.getEventId());
        List<TeamEventEntry> approved = teamEventEntryRepository
                .findAllByEvent_EventIdAndStatus(event.getEventId(), "APPROVED");

        Map<Integer, Long> perTrack = approved.stream()
                .filter(t -> t.getTrack() != null)
                .collect(Collectors.groupingBy(t -> t.getTrack().getTrackId(), Collectors.counting()));
        long unassigned = approved.stream().filter(t -> t.getTrack() == null).count();

        List<String> problems = new ArrayList<>();
        if (tracks.isEmpty()) {
            problems.add("the event has no tracks");
        }
        for (Track tr : tracks) {
            long count = perTrack.getOrDefault(tr.getTrackId(), 0L);
            if (count < MIN_TEAMS_PER_TRACK) {
                problems.add("track \"" + tr.getName() + "\" has " + count
                        + " team(s) (needs at least " + MIN_TEAMS_PER_TRACK + ")");
            }
        }
        if (unassigned > 0) {
            problems.add(unassigned + " team(s) still unassigned");
        }

        if (!problems.isEmpty()) {
            throw new BadRequestException("Cannot start the event: " + String.join("; ", problems) + ".");
        }
    }

    private void requireValidTransition(String from, String to) {
        if (from == null || from.equals(to)) {
            return;
        }
        if (!TRANSITIONS.getOrDefault(from, Set.of()).contains(to)) {
            throw new BadRequestException("Invalid status change: " + from + " -> " + to + ".");
        }
    }

    /** Enforces registrationStart <= registrationEnd <= startDate <= endDate. */
    private void requireValidDates(LocalDateTime regStart, LocalDateTime regEnd,
                                   LocalDateTime start, LocalDateTime end) {
        if (regStart != null && regEnd != null && regEnd.isBefore(regStart)) {
            throw new BadRequestException("Registration end must be on or after registration start.");
        }
        if (start != null && end != null && end.isBefore(start)) {
            throw new BadRequestException("End date must be on or after start date.");
        }
        if (regEnd != null && start != null && start.isBefore(regEnd)) {
            throw new BadRequestException("The competition must start after registration closes.");
        }
    }

    private String normalizeEventName(String name) {
        if (name == null || name.isBlank()) {
            throw new BadRequestException("Event name is required.");
        }
        String normalized = name.trim();
        if (normalized.length() > 255) {
            throw new BadRequestException("Event name must not exceed 255 characters.");
        }
        return normalized;
    }

    private String normalizeSeason(String season) {
        if (season == null || season.isBlank()) {
            throw new BadRequestException("Season is required.");
        }
        String normalized = season.trim().toUpperCase();
        if (!VALID_SEASONS.contains(normalized)) {
            throw new BadRequestException("Invalid season. Must be SPRING, SUMMER, or FALL.");
        }
        return normalized;
    }

    private Integer validateYear(Integer year) {
        if (year == null) {
            throw new BadRequestException("Year is required.");
        }
        if (year < 2026 || year > 3000) {
            throw new BadRequestException("Year must be between 2026 and 3000.");
        }
        return year;
    }

    private void validateCompleteEventSchedule(String season, Integer year,
                                               LocalDateTime regStart, LocalDateTime regEnd,
                                               LocalDateTime start, LocalDateTime end) {
        validateYear(year);
        if (regStart == null || regEnd == null || start == null || end == null) {
            throw new BadRequestException(
                    "Registration start, registration end, start date, and end date are all required.");
        }
        requireValidDates(regStart, regEnd, start, end);
        requireDateInSeason("Registration start date", regStart, season, year);
        requireDateInSeason("Registration end date", regEnd, season, year);
        requireDateInSeason("Start date", start, season, year);
        requireDateInSeason("End date", end, season, year);
    }

    private void requireDateInSeason(String label, LocalDateTime value, String season, Integer year) {
        SeasonWindow window = seasonWindow(season, year);
        LocalDate date = value.toLocalDate();
        if (date.isBefore(window.start()) || date.isAfter(window.end())) {
            throw new BadRequestException(label + " must be within " + season + " " + year
                    + " (" + window.start() + " to " + window.end() + ").");
        }
    }

    private SeasonWindow seasonWindow(String season, Integer year) {
        return switch (normalizeSeason(season)) {
            case "SPRING" -> new SeasonWindow(LocalDate.of(year, 1, 1), LocalDate.of(year, 4, 30));
            case "SUMMER" -> new SeasonWindow(LocalDate.of(year, 5, 1), LocalDate.of(year, 8, 31));
            case "FALL" -> new SeasonWindow(LocalDate.of(year, 9, 1), LocalDate.of(year, 12, 31));
            default -> throw new BadRequestException("Invalid season. Must be SPRING, SUMMER, or FALL.");
        };
    }

    private void requireDatesNotBeforeToday(boolean includeAllDates,
                                            LocalDateTime regStart, LocalDateTime regEnd,
                                            LocalDateTime start, LocalDateTime end) {
        if (!includeAllDates) {
            return;
        }
        LocalDate today = LocalDate.now();
        requireDateNotBeforeToday("Registration start date", regStart, today);
        requireDateNotBeforeToday("Registration end date", regEnd, today);
        requireDateNotBeforeToday("Start date", start, today);
        requireDateNotBeforeToday("End date", end, today);
    }

    private void requireRequestedDatesNotBeforeToday(UpdateEventRequest request) {
        LocalDate today = LocalDate.now();
        requireDateNotBeforeToday("Registration start date", request.getRegistrationStart(), today);
        requireDateNotBeforeToday("Registration end date", request.getRegistrationEnd(), today);
        requireDateNotBeforeToday("Start date", request.getStartDate(), today);
        requireDateNotBeforeToday("End date", request.getEndDate(), today);
    }

    private void requireDateNotBeforeToday(String label, LocalDateTime value, LocalDate today) {
        if (value != null && value.toLocalDate().isBefore(today)) {
            throw new BadRequestException(label + " cannot be in the past.");
        }
    }

    private void validateUniqueActiveSeasonEvent(Integer year, String season, String status, Integer excludeEventId) {
        if (CANCELLED_STATUS.equalsIgnoreCase(status)) {
            return;
        }
        boolean exists = excludeEventId == null
                ? hackathonEventRepository.existsByYearAndSeasonIgnoreCaseAndStatusNotIgnoreCase(
                        year, season, CANCELLED_STATUS)
                : hackathonEventRepository.existsByYearAndSeasonIgnoreCaseAndStatusNotIgnoreCaseAndEventIdNot(
                        year, season, CANCELLED_STATUS, excludeEventId);
        if (exists) {
            throw new BadRequestException("An active event already exists for " + season + " " + year + ".");
        }
    }

    private void validateNoOverlappingActiveEvent(LocalDateTime start, LocalDateTime end,
                                                  String status, Integer excludeEventId) {
        if (CANCELLED_STATUS.equalsIgnoreCase(status)) {
            return;
        }
        if (hackathonEventRepository.existsOverlappingActiveEvent(start, end, excludeEventId, CANCELLED_STATUS)) {
            throw new BadRequestException("Event dates overlap with another active event.");
        }
    }

    private record SeasonWindow(LocalDate start, LocalDate end) {
    }

    private HackathonEventResponse mapToResponse(HackathonEvent event) {
        return HackathonEventResponse.builder()
                .eventId(event.getEventId())
                .name(event.getName())
                .season(event.getSeason())
                .year(event.getYear())
                .description(event.getDescription())
                .topic(event.getTopic())
                .registrationStart(event.getRegistrationStart())
                .registrationEnd(event.getRegistrationEnd())
                .startDate(event.getStartDate())
                .endDate(event.getEndDate())
                .status(event.getStatus())
                .trackSelectionMode(event.getTrackSelectionMode())
                .createdAt(event.getCreatedAt())
                .build();
    }
}
