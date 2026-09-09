package com.seal.hackathon.service;

import com.seal.hackathon.dto.response.RoundResultResponse;
import com.seal.hackathon.entity.*;
import com.seal.hackathon.exception.BadRequestException;
import com.seal.hackathon.exception.ResourceNotFoundException;
import com.seal.hackathon.repository.*;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class RoundResultService {

    private final RoundResultRepository resultRepository;
    private final RoundRepository roundRepository;
    private final SubmissionRepository submissionRepository;
    private final ScoreRepository scoreRepository;
    private final ScoringCriteriaRepository criteriaRepository;
    private final UserRepository userRepository;
    private final HackathonEventRepository eventRepository;
    private final TeamMemberRepository teamMemberRepository;
    private final TeamEventEntryRepository teamEventEntryRepository;
    private final NotificationService notificationService;
    private final JudgeScoringCompletenessService completenessService;
    private final HackathonEventService hackathonEventService;

    // ── Get leaderboard (published results only) ──────────────────────

    @Transactional(readOnly = true)
    public List<RoundResultResponse> getPublishedResults(Integer eventId, Integer roundId) {
        return resultRepository
                .findAllByRound_RoundIdAndIsPublishedTrueOrderByRankPosition(roundId).stream()
                .map(this::mapToResponse)
                .collect(Collectors.toList());
    }

    // ── Coordinator: get all results (including unpublished) ──────────

    @Transactional(readOnly = true)
    public List<RoundResultResponse> getAllResults(Integer eventId, Integer roundId) {
        return resultRepository.findAllByRound_RoundIdOrderByRankPosition(roundId).stream()
                .map(this::mapToResponse)
                .collect(Collectors.toList());
    }

    // ── Coordinator: finalize round — compute weighted scores, rank ───

    @Transactional
    public List<RoundResultResponse> finalizeRound(Integer eventId, Integer roundId, Integer coordinatorId) {
        Round round = roundRepository.findByIdAndEventId(roundId, eventId)
                .orElseThrow(() -> new ResourceNotFoundException("Round not found: " + roundId));

        if ("FINALIZED".equalsIgnoreCase(round.getStatus())) {
            throw new BadRequestException("Round is already finalized.");
        }

        User coordinator = userRepository.findById(coordinatorId)
                .orElseThrow(() -> new ResourceNotFoundException("User not found: " + coordinatorId));

        // Disqualified teams drop out of the competition — their submission (if
        // any) is excluded from both the completeness gate and the ranking itself,
        // so a team disqualified after submitting can never re-enter via recalculation.
        List<Submission> submissions = submissionRepository.findAllByRound_RoundId(roundId).stream()
                .filter(s -> !isDisqualified(s.getTeam().getTeamId(), eventId))
                .collect(Collectors.toList());
        if (submissions.isEmpty()) {
            throw new BadRequestException("No submissions found for this round.");
        }

        // Every judge assigned to the submission's (round, track) cell must have
        // finalized every criterion. Missing judges are never treated as zero or
        // silently removed from the panel average.
        completenessService.assertRoundComplete(roundId);

        // Delete existing results for this round before re-computing
        List<RoundResult> existing = resultRepository.findAllByRound_RoundIdOrderByRankPosition(roundId);
        resultRepository.deleteAll(existing);

        // Compute the normalized 0–100 weighted-average score per team.
        Map<Integer, BigDecimal> teamScores = new LinkedHashMap<>();
        for (Submission submission : submissions) {
            List<Score> scores = scoreRepository.findAllBySubmission_SubmissionId(
                    submission.getSubmissionId()).stream()
                    .filter(s -> !Boolean.TRUE.equals(s.getIsDraft()))
                    .collect(Collectors.toList());

            if (scores.isEmpty()) {
                teamScores.put(submission.getTeam().getTeamId(), BigDecimal.ZERO);
                continue;
            }

            // Use the same normalized per-judge score exposed by completed-event
            // analytics, then average the panel to obtain the team result.
            Map<Integer, List<Score>> scoresByJudge = scores.stream()
                    .collect(Collectors.groupingBy(score -> score.getJudge().getUserId()));
            List<BigDecimal> judgePercents = scoresByJudge.values().stream()
                    .map(ScoreNormalization::weightedPercent)
                    .flatMap(Optional::stream)
                    .toList();

            if (judgePercents.isEmpty()) {
                teamScores.put(submission.getTeam().getTeamId(), BigDecimal.ZERO);
                continue;
            }

            BigDecimal avg = judgePercents.stream()
                    .reduce(BigDecimal.ZERO, BigDecimal::add)
                    .divide(BigDecimal.valueOf(judgePercents.size()), 2, RoundingMode.HALF_UP);

            teamScores.put(submission.getTeam().getTeamId(), avg);
        }

        List<RoundResult> results = new ArrayList<>();
        Map<Integer, Submission> subByTeam = submissions.stream()
                .collect(Collectors.toMap(s -> s.getTeam().getTeamId(), s -> s));
        // Team lookup by id — seeded from submissions, extended below with finalists
        // who never submitted (so we can still rank and name them).
        Map<Integer, Team> teamById = new HashMap<>();
        submissions.forEach(s -> teamById.put(s.getTeam().getTeamId(), s.getTeam()));

        if (Boolean.TRUE.equals(round.getIsFinal())) {
            // Final round — one global ranking across ALL finalists (no per-track split).
            // Finalists = every team that advanced from the previous round, not only the
            // ones that submitted here: a team that reached the final but never submitted
            // must still appear (scored 0, ranked last) so the leaderboard lists everyone.
            for (Integer finalistTeamId : resolveFinalistTeamIds(round, teamById)) {
                teamScores.putIfAbsent(finalistTeamId, BigDecimal.ZERO);
            }
            List<Map.Entry<Integer, BigDecimal>> ranked = new ArrayList<>(teamScores.entrySet());
            ranked.sort(rankingComparator(subByTeam));
            for (int i = 0; i < ranked.size(); i++) {
                Map.Entry<Integer, BigDecimal> e = ranked.get(i);
                results.add(saveResult(round, coordinator, teamById.get(e.getKey()), e.getValue(), i + 1));
            }
        } else {
            // Per-track round — rank teams within each track separately so the cut-off
            // (rank_position <= top_n_advance) means "top N of THIS track advance". Teams
            // with no track fall into a single null bucket. Preserves track encounter order.
            Map<Integer, List<Map.Entry<Integer, BigDecimal>>> byTrack = new LinkedHashMap<>();
            for (Map.Entry<Integer, BigDecimal> entry : teamScores.entrySet()) {
                Track track = teamEventEntryRepository
                        .findByTeam_TeamIdAndEvent_EventId(entry.getKey(), eventId)
                        .map(TeamEventEntry::getTrack)
                        .orElse(null);
                Integer trackId = track != null ? track.getTrackId() : null;
                byTrack.computeIfAbsent(trackId, k -> new ArrayList<>()).add(entry);
            }
            for (List<Map.Entry<Integer, BigDecimal>> group : byTrack.values()) {
                group.sort(rankingComparator(subByTeam));
                for (int i = 0; i < group.size(); i++) {
                    Map.Entry<Integer, BigDecimal> e = group.get(i);
                    results.add(saveResult(round, coordinator, teamById.get(e.getKey()), e.getValue(), i + 1));
                }
            }
        }

        return results.stream().map(this::mapToResponse).collect(Collectors.toList());
    }

    // ── Coordinator: publish results ──────────────────────────────────

    @Transactional
    public List<RoundResultResponse> publishResults(Integer eventId, Integer roundId) {
        var round = roundRepository.findByIdAndEventId(roundId, eventId)
                .orElseThrow(() -> new ResourceNotFoundException("Round not found: " + roundId));

        List<RoundResult> results = resultRepository.findAllByRound_RoundIdOrderByRankPosition(roundId);
        if (results.isEmpty()) {
            throw new BadRequestException("No results to publish. Please calculate rankings first.");
        }

        List<RoundResult> newlyPublished = results.stream()
                .filter(r -> !Boolean.TRUE.equals(r.getIsPublished()))
                .collect(Collectors.toList());
        results.forEach(r -> r.setIsPublished(true));
        resultRepository.saveAll(results);
        newlyPublished.forEach(this::notifyTeamResultPublished);

        round.setStatus("FINALIZED");
        roundRepository.save(round);

        // Notify each ranked team that results are out.
        String roundName = round.getName();
        results.forEach(r -> teamMemberRepository.findByTeam_TeamId(r.getTeam().getTeamId())
                .forEach(m -> notificationService.createNotification(
                        m.getUser().getUserId(),
                        "Results published",
                        "Results for \"" + roundName + "\" are out — your team ranked #"
                                + r.getRankPosition() + (isAdvanced(r) ? " and advanced!" : "."),
                        "RESULT")));

        // If this is the final round, automatically mark the event as COMPLETED.
        if (Boolean.TRUE.equals(round.getIsFinal())) {
            HackathonEvent event = eventRepository.findById(eventId)
                    .orElseThrow(() -> new ResourceNotFoundException("Event not found: " + eventId));
            if ("IN_PROGRESS".equalsIgnoreCase(event.getStatus())) {
                hackathonEventService.completeEvent(eventId);
            }
        }

        return results.stream().map(this::mapToResponse).collect(Collectors.toList());
    }

    // ── Helper ────────────────────────────────────────────────────────

    private RoundResult saveResult(Round round, User coordinator, Team team,
                                   BigDecimal score, int rank) {
        RoundResult result = RoundResult.builder()
                .team(team)
                .round(round)
                .totalScore(score)
                .rankPosition(rank)
                .isPublished(false)
                .finalizedAt(LocalDateTime.now())
                .finalizedBy(coordinator)
                .build();
        return resultRepository.save(result);
    }

    /**
     * The finalist team set for a final round: every team that advanced from the
     * immediately-preceding round (rank_position &lt;= that round's top_n_advance), which
     * mirrors the submission advancement gate in {@code SubmissionService}. Teams are
     * sourced from the previous round's results so we have their {@link Team} even when
     * they never submitted in the final; each is registered in {@code teamById}.
     *
     * <p>If there is no preceding round, or it is not yet FINALIZED, or it has no cut-off,
     * no extra finalists are added — the ranking then falls back to whoever submitted.
     */
    private Set<Integer> resolveFinalistTeamIds(Round finalRound, Map<Integer, Team> teamById) {
        Set<Integer> finalistIds = new LinkedHashSet<>();
        roundRepository.findAllByEvent_EventIdOrderByOrderNumber(finalRound.getEvent().getEventId()).stream()
                .filter(r -> r.getOrderNumber() < finalRound.getOrderNumber())
                .max(Comparator.comparingInt(Round::getOrderNumber))
                .ifPresent(prev -> {
                    Integer cutoff = prev.getTopNAdvance();
                    if ("FINALIZED".equalsIgnoreCase(prev.getStatus()) && cutoff != null) {
                        resultRepository.findAllByRound_RoundIdOrderByRankPosition(prev.getRoundId()).stream()
                                .filter(rr -> rr.getRankPosition() != null && rr.getRankPosition() <= cutoff)
                                .forEach(rr -> {
                                    finalistIds.add(rr.getTeam().getTeamId());
                                    teamById.putIfAbsent(rr.getTeam().getTeamId(), rr.getTeam());
                                });
                    }
                });
        return finalistIds;
    }

    /**
     * Ranking order: highest score first; ties broken by the EARLIER submission
     * (so the team that submitted sooner takes the higher rank, e.g. the last Top-N
     * slot). Teams missing a submission time sort last.
     */
    private Comparator<Map.Entry<Integer, BigDecimal>> rankingComparator(Map<Integer, Submission> subByTeam) {
        return (a, b) -> {
            int byScore = b.getValue().compareTo(a.getValue());
            if (byScore != 0) return byScore;
            Submission sa = subByTeam.get(a.getKey());
            Submission sb = subByTeam.get(b.getKey());
            LocalDateTime ta = sa != null ? sa.getSubmittedAt() : null;
            LocalDateTime tb = sb != null ? sb.getSubmittedAt() : null;
            if (ta == null && tb == null) return 0;
            if (ta == null) return 1;
            if (tb == null) return -1;
            return ta.compareTo(tb);
        };
    }

    private boolean isDisqualified(Integer teamId, Integer eventId) {
        return teamEventEntryRepository.findByTeam_TeamIdAndEvent_EventId(teamId, eventId)
                .map(entry -> "DISQUALIFIED".equalsIgnoreCase(entry.getStatus()))
                .orElse(false);
    }

    private RoundResultResponse mapToResponse(RoundResult r) {
        Track track = teamEventEntryRepository
                .findByTeam_TeamIdAndEvent_EventId(r.getTeam().getTeamId(), r.getRound().getEvent().getEventId())
                .map(TeamEventEntry::getTrack)
                .orElse(null);
        return RoundResultResponse.builder()
                .resultId(r.getResultId())
                .teamId(r.getTeam().getTeamId())
                .teamName(r.getTeam().getName())
                .trackName(track != null ? track.getName() : null)
                .roundId(r.getRound().getRoundId())
                .roundName(r.getRound().getName())
                .totalScore(r.getTotalScore())
                .rankPosition(r.getRankPosition())
                // "advanced" is derived, not stored: rank_position <= Round.top_n_advance
                .advanced(isAdvanced(r))
                .isPublished(r.getIsPublished())
                .finalizedAt(r.getFinalizedAt())
                .finalizedById(r.getFinalizedBy() != null ? r.getFinalizedBy().getUserId() : null)
                .finalizedByName(r.getFinalizedBy() != null ? r.getFinalizedBy().getFullName() : null)
                .build();
    }

    /**
     * Derives whether a team advances: rank_position <= Round.top_n_advance.
     * If top_n_advance is null (no cut-off configured), no team is marked advanced.
     */
    private boolean isAdvanced(RoundResult r) {
        Integer topN = r.getRound().getTopNAdvance();
        return topN != null && r.getRankPosition() <= topN;
    }

    private void notifyTeamResultPublished(RoundResult result) {
        String content = "Results for round '" + result.getRound().getName() + "' have been published. " +
                "Team '" + result.getTeam().getName() + "' ranked #" + result.getRankPosition() + ".";
        if (isAdvanced(result)) {
            content += " Your team advanced to the next round.";
        }
        String notificationContent = content;
        teamMemberRepository.findByTeam_TeamId(result.getTeam().getTeamId())
                .forEach(member -> notificationService.createNotification(
                        member.getUser().getUserId(),
                        "Round results published",
                        notificationContent,
                        "RESULT_PUBLISHED"
                ));
    }
}
