package com.seal.hackathon.service;

import com.seal.hackathon.dto.response.RoundResultResponse;
import com.seal.hackathon.entity.HackathonEvent;
import com.seal.hackathon.entity.Round;
import com.seal.hackathon.entity.RoundResult;
import com.seal.hackathon.entity.Score;
import com.seal.hackathon.entity.ScoringCriteria;
import com.seal.hackathon.entity.Submission;
import com.seal.hackathon.entity.Team;
import com.seal.hackathon.entity.TeamEventEntry;
import com.seal.hackathon.entity.User;
import com.seal.hackathon.exception.BadRequestException;
import com.seal.hackathon.repository.HackathonEventRepository;
import com.seal.hackathon.repository.RoundRepository;
import com.seal.hackathon.repository.RoundResultRepository;
import com.seal.hackathon.repository.ScoreRepository;
import com.seal.hackathon.repository.ScoringCriteriaRepository;
import com.seal.hackathon.repository.SubmissionRepository;
import com.seal.hackathon.repository.TeamEventEntryRepository;
import com.seal.hackathon.repository.TeamMemberRepository;
import com.seal.hackathon.repository.UserRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class RoundResultServiceTest {

    @Mock
    private RoundResultRepository resultRepository;

    @Mock
    private RoundRepository roundRepository;

    @Mock
    private SubmissionRepository submissionRepository;

    @Mock
    private ScoreRepository scoreRepository;

    @Mock
    private ScoringCriteriaRepository criteriaRepository;

    @Mock
    private UserRepository userRepository;

    @Mock
    private HackathonEventRepository eventRepository;

    @Mock
    private TeamMemberRepository teamMemberRepository;

    @Mock
    private TeamEventEntryRepository teamEventEntryRepository;

    @Mock
    private NotificationService notificationService;

    @Mock
    private JudgeScoringCompletenessService completenessService;

    @Mock
    private HackathonEventService hackathonEventService;

    @InjectMocks
    private RoundResultService roundResultService;

    @Test
    void finalizeRound_shouldCalculateDraftRankingWithoutFinalizingRound() {
        HackathonEvent event = event(1);
        Round round = round(10, event, "ACTIVE");
        User coordinator = user(7, "Coordinator");
        Team team = team(20, "Seal Team");
        Submission submission = submission(30, team, round, coordinator);

        when(roundRepository.findByIdAndEventId(round.getRoundId(), event.getEventId()))
                .thenReturn(Optional.of(round));
        when(userRepository.findById(coordinator.getUserId())).thenReturn(Optional.of(coordinator));
        when(submissionRepository.findAllByRound_RoundId(round.getRoundId())).thenReturn(List.of(submission));
        when(resultRepository.findAllByRound_RoundIdOrderByRankPosition(round.getRoundId())).thenReturn(List.of());
        when(scoreRepository.findAllBySubmission_SubmissionId(submission.getSubmissionId())).thenReturn(List.of());
        when(resultRepository.save(any(RoundResult.class))).thenAnswer(inv -> {
            RoundResult result = inv.getArgument(0);
            result.setResultId(100);
            return result;
        });
        when(teamEventEntryRepository.findByTeam_TeamIdAndEvent_EventId(team.getTeamId(), event.getEventId()))
                .thenReturn(Optional.empty());

        List<RoundResultResponse> response = roundResultService.finalizeRound(
                event.getEventId(), round.getRoundId(), coordinator.getUserId());

        assertEquals("ACTIVE", round.getStatus());
        assertEquals(1, response.size());
        assertFalse(response.get(0).getIsPublished());
        verify(roundRepository, never()).save(any(Round.class));
    }

    @Test
    void publishResults_shouldPublishResultsAndFinalizeRound() {
        HackathonEvent event = event(1);
        Round round = round(10, event, "ACTIVE");
        Team team = team(20, "Seal Team");
        RoundResult result = RoundResult.builder()
                .resultId(100)
                .team(team)
                .round(round)
                .totalScore(BigDecimal.valueOf(88))
                .rankPosition(1)
                .isPublished(false)
                .build();

        when(roundRepository.findByIdAndEventId(round.getRoundId(), event.getEventId()))
                .thenReturn(Optional.of(round));
        when(resultRepository.findAllByRound_RoundIdOrderByRankPosition(round.getRoundId()))
                .thenReturn(List.of(result));
        when(teamMemberRepository.findByTeam_TeamId(team.getTeamId())).thenReturn(List.of());
        when(teamEventEntryRepository.findByTeam_TeamIdAndEvent_EventId(team.getTeamId(), event.getEventId()))
                .thenReturn(Optional.empty());

        List<RoundResultResponse> response = roundResultService.publishResults(event.getEventId(), round.getRoundId());

        assertEquals("FINALIZED", round.getStatus());
        assertTrue(result.getIsPublished());
        assertEquals(1, response.size());
        assertTrue(response.get(0).getIsPublished());
        verify(roundRepository).save(round);
    }

    @Test
    void finalizeRound_shouldExcludeDisqualifiedTeamFromRankingAndCompletenessGate() {
        HackathonEvent event = event(1);
        Round round = round(10, event, "ACTIVE");
        User coordinator = user(7, "Coordinator");
        User judge = user(11, "Judge A");
        Team ok = team(20, "Arsenal");
        Team disqualified = team(21, "Chelsea");
        Submission okSubmission = submission(30, ok, round, coordinator);
        Submission dqSubmission = submission(31, disqualified, round, coordinator);
        ScoringCriteria criteria = ScoringCriteria.builder()
                .criteriaId(40).round(round).name("Innovation")
                .maxScore(BigDecimal.TEN).weight(BigDecimal.ONE).build();
        Score score = Score.builder()
                .submission(okSubmission).judge(judge).criteria(criteria)
                .value(BigDecimal.valueOf(8)).isDraft(false).build();

        when(roundRepository.findByIdAndEventId(round.getRoundId(), event.getEventId()))
                .thenReturn(Optional.of(round));
        when(userRepository.findById(coordinator.getUserId())).thenReturn(Optional.of(coordinator));
        when(submissionRepository.findAllByRound_RoundId(round.getRoundId()))
                .thenReturn(List.of(okSubmission, dqSubmission));
        when(resultRepository.findAllByRound_RoundIdOrderByRankPosition(round.getRoundId())).thenReturn(List.of());
        when(teamEventEntryRepository.findByTeam_TeamIdAndEvent_EventId(ok.getTeamId(), event.getEventId()))
                .thenReturn(Optional.of(TeamEventEntry.builder().team(ok).event(event).status("APPROVED").build()));
        when(teamEventEntryRepository.findByTeam_TeamIdAndEvent_EventId(disqualified.getTeamId(), event.getEventId()))
                .thenReturn(Optional.of(TeamEventEntry.builder().team(disqualified).event(event).status("DISQUALIFIED").build()));
        when(scoreRepository.findAllBySubmission_SubmissionId(okSubmission.getSubmissionId())).thenReturn(List.of(score));
        when(resultRepository.save(any(RoundResult.class))).thenAnswer(inv -> inv.getArgument(0));

        List<RoundResultResponse> response = roundResultService.finalizeRound(
                event.getEventId(), round.getRoundId(), coordinator.getUserId());

        assertEquals(1, response.size());
        assertEquals(ok.getTeamId(), response.get(0).getTeamId());
        verify(completenessService).assertRoundComplete(round.getRoundId());
        // The disqualified team's submission must never reach score lookup.
        verify(scoreRepository, never()).findAllBySubmission_SubmissionId(dqSubmission.getSubmissionId());
    }

    @Test
    void finalizeRound_shouldThrowBadRequest_whenOnlySubmissionIsFromDisqualifiedTeam() {
        HackathonEvent event = event(1);
        Round round = round(10, event, "ACTIVE");
        User coordinator = user(7, "Coordinator");
        Team disqualified = team(21, "Chelsea");
        Submission dqSubmission = submission(31, disqualified, round, coordinator);

        when(roundRepository.findByIdAndEventId(round.getRoundId(), event.getEventId()))
                .thenReturn(Optional.of(round));
        when(userRepository.findById(coordinator.getUserId())).thenReturn(Optional.of(coordinator));
        when(submissionRepository.findAllByRound_RoundId(round.getRoundId())).thenReturn(List.of(dqSubmission));
        when(teamEventEntryRepository.findByTeam_TeamIdAndEvent_EventId(disqualified.getTeamId(), event.getEventId()))
                .thenReturn(Optional.of(TeamEventEntry.builder().team(disqualified).event(event).status("DISQUALIFIED").build()));

        BadRequestException error = assertThrows(BadRequestException.class,
                () -> roundResultService.finalizeRound(event.getEventId(), round.getRoundId(), coordinator.getUserId()));

        assertTrue(error.getMessage().contains("No submissions"));
        verify(completenessService, never()).assertRoundComplete(any());
    }

    @Test
    void publishResults_shouldPublishResultsAndNotCompleteEvent_whenRoundIsNotFinal() {
        HackathonEvent event = event(1);
        Round round = round(10, event, "ACTIVE");
        round.setIsFinal(false);
        Team team = team(20, "Seal Team");
        RoundResult result = RoundResult.builder()
                .resultId(100)
                .round(round)
                .team(team)
                .rankPosition(1)
                .totalScore(BigDecimal.TEN)
                .isPublished(false)
                .build();

        when(roundRepository.findByIdAndEventId(round.getRoundId(), event.getEventId()))
                .thenReturn(Optional.of(round));
        when(resultRepository.findAllByRound_RoundIdOrderByRankPosition(round.getRoundId()))
                .thenReturn(List.of(result));
        when(teamMemberRepository.findByTeam_TeamId(team.getTeamId())).thenReturn(List.of());

        List<RoundResultResponse> responses = roundResultService.publishResults(event.getEventId(), round.getRoundId());

        assertEquals(1, responses.size());
        assertTrue(result.getIsPublished());
        assertEquals("FINALIZED", round.getStatus());
        verify(roundRepository).save(round);
        verify(hackathonEventService, never()).completeEvent(any());
    }

    @Test
    void publishResults_shouldCompleteEvent_whenRoundIsFinalAndEventIsInProgress() {
        HackathonEvent event = event(1);
        event.setStatus("IN_PROGRESS");
        Round round = round(10, event, "ACTIVE");
        round.setIsFinal(true);
        Team team = team(20, "Seal Team");
        RoundResult result = RoundResult.builder()
                .resultId(100)
                .round(round)
                .team(team)
                .rankPosition(1)
                .totalScore(BigDecimal.TEN)
                .isPublished(false)
                .build();

        when(roundRepository.findByIdAndEventId(round.getRoundId(), event.getEventId()))
                .thenReturn(Optional.of(round));
        when(resultRepository.findAllByRound_RoundIdOrderByRankPosition(round.getRoundId()))
                .thenReturn(List.of(result));
        when(teamMemberRepository.findByTeam_TeamId(team.getTeamId())).thenReturn(List.of());
        when(eventRepository.findById(event.getEventId())).thenReturn(Optional.of(event));

        List<RoundResultResponse> responses = roundResultService.publishResults(event.getEventId(), round.getRoundId());

        assertEquals(1, responses.size());
        assertTrue(result.getIsPublished());
        assertEquals("FINALIZED", round.getStatus());
        verify(roundRepository).save(round);
        verify(hackathonEventService).completeEvent(event.getEventId());
    }

    private HackathonEvent event(Integer eventId) {
        return HackathonEvent.builder()
                .eventId(eventId)
                .name("SEAL Hackathon")
                .build();
    }

    private Round round(Integer roundId, HackathonEvent event, String status) {
        return Round.builder()
                .roundId(roundId)
                .event(event)
                .name("Round " + roundId)
                .orderNumber(1)
                .isFinal(false)
                .status(status)
                .build();
    }

    private Team team(Integer teamId, String name) {
        return Team.builder()
                .teamId(teamId)
                .name(name)
                .build();
    }

    private User user(Integer userId, String fullName) {
        return User.builder()
                .userId(userId)
                .fullName(fullName)
                .build();
    }

    private Submission submission(Integer submissionId, Team team, Round round, User submittedBy) {
        return Submission.builder()
                .submissionId(submissionId)
                .team(team)
                .round(round)
                .submittedBy(submittedBy)
                .submittedAt(LocalDateTime.of(2026, 7, 21, 10, 0))
                .build();
    }
}
