package com.seal.hackathon.service;

import com.seal.hackathon.dto.request.CreateRoundRequest;
import com.seal.hackathon.dto.request.UpdateRoundRequest;
import com.seal.hackathon.dto.response.RoundDetailResponse;
import com.seal.hackathon.dto.response.RoundResponse;
import com.seal.hackathon.entity.HackathonEvent;
import com.seal.hackathon.entity.Round;
import com.seal.hackathon.exception.BadRequestException;
import com.seal.hackathon.exception.ResourceNotFoundException;
import com.seal.hackathon.repository.HackathonEventRepository;
import com.seal.hackathon.repository.RoundRepository;
import com.seal.hackathon.repository.RoundResultRepository;
import com.seal.hackathon.repository.ScoringCriteriaRepository;
import com.seal.hackathon.repository.SubmissionRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class RoundService {

    private final RoundRepository roundRepository;
    private final HackathonEventRepository eventRepository;
    private final SubmissionRepository submissionRepository;
    private final ScoringCriteriaRepository criteriaRepository;
    private final RoundResultRepository resultRepository;

    @Transactional(readOnly = true)
    public RoundDetailResponse getRoundDetail(Integer eventId, Integer roundId) {
        Round round = roundRepository.findByIdAndEventId(roundId, eventId)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "Round ID " + roundId + " not found in Event ID " + eventId));
        return mapToDetailResponse(round);
    }

    @Transactional(readOnly = true)
    public List<RoundResponse> getRoundsByEvent(Integer eventId) {
        eventRepository.findById(eventId)
                .orElseThrow(() -> new ResourceNotFoundException("Event not found: " + eventId));
        return roundRepository.findAllByEvent_EventIdOrderByOrderNumber(eventId).stream()
                .sorted(Comparator.comparing((Round r) -> Boolean.TRUE.equals(r.getIsFinal()) ? 1 : 0)
                        .thenComparing(Round::getOrderNumber, Comparator.nullsLast(Comparator.naturalOrder())))
                .map(this::mapToResponse)
                .collect(Collectors.toList());
    }

    private void resequenceRounds(Integer eventId) {
        List<Round> allRounds = roundRepository.findAllByEvent_EventIdOrderByOrderNumber(eventId);
        if (allRounds.isEmpty()) {
            return;
        }

        Comparator<Round> orderComparator = (r1, r2) -> {
            int o1 = r1.getOrderNumber() != null ? r1.getOrderNumber() : 0;
            int o2 = r2.getOrderNumber() != null ? r2.getOrderNumber() : 0;
            if (o1 > 0 && o2 > 0) {
                return Integer.compare(o1, o2);
            }
            if (o1 <= 0 && o2 > 0) return 1;
            if (o1 > 0 && o2 <= 0) return -1;
            return Integer.compare(
                    r1.getRoundId() != null ? r1.getRoundId() : 0,
                    r2.getRoundId() != null ? r2.getRoundId() : 0
            );
        };

        // Normal rounds first, positive order preserved, newly added rounds placed at the end
        List<Round> normalRounds = allRounds.stream()
                .filter(r -> !Boolean.TRUE.equals(r.getIsFinal()))
                .sorted(orderComparator)
                .toList();

        // Final round(s)
        List<Round> finalRounds = allRounds.stream()
                .filter(r -> Boolean.TRUE.equals(r.getIsFinal()))
                .sorted(orderComparator)
                .toList();

        List<Round> ordered = new ArrayList<>(normalRounds);
        ordered.addAll(finalRounds);

        // Step 1: Temporarily assign negative order numbers to avoid uq_round_event_order collisions
        for (int i = 0; i < ordered.size(); i++) {
            Round r = ordered.get(i);
            r.setOrderNumber(-(i + 1));
            roundRepository.saveAndFlush(r);
        }

        // Step 2: Assign consecutive positive order numbers 1, 2, ..., N
        for (int i = 0; i < ordered.size(); i++) {
            Round r = ordered.get(i);
            r.setOrderNumber(i + 1);
            roundRepository.saveAndFlush(r);
        }
    }

    private static final DateTimeFormatter DTF = DateTimeFormatter.ofPattern("dd/MM/yyyy HH:mm");

    @Transactional
    public RoundResponse createRound(Integer eventId, CreateRoundRequest request) {
        HackathonEvent event = eventRepository.findById(eventId)
                .orElseThrow(() -> new ResourceNotFoundException("Event not found: " + eventId));

        LocalDateTime startTime = request.getStartTime();
        LocalDateTime endTime = request.getEndTime();

        // 1. Check Start < End
        if (!startTime.isBefore(endTime)) {
            throw new BadRequestException("Round start time must be strictly before end time.");
        }

        // 2. Check within event dates
        if (event.getStartDate() != null && startTime.isBefore(event.getStartDate())) {
            throw new BadRequestException("Round start time (" + startTime.format(DTF)
                    + ") cannot be earlier than event start date (" + event.getStartDate().format(DTF) + ").");
        }
        if (event.getEndDate() != null && endTime.isAfter(event.getEndDate())) {
            throw new BadRequestException("Round end time (" + endTime.format(DTF)
                    + ") cannot be later than event end date (" + event.getEndDate().format(DTF) + ").");
        }

        boolean isFinal = Boolean.TRUE.equals(request.getIsFinal());
        List<Round> existing = roundRepository.findAllByEvent_EventIdOrderByOrderNumber(eventId);

        // 3. Check conflict/overlap with other rounds in the event
        for (Round other : existing) {
            if (startTime.isBefore(other.getEndTime()) && other.getStartTime().isBefore(endTime)) {
                throw new BadRequestException("Round time conflicts with round \"" + other.getName() + "\" ("
                        + other.getStartTime().format(DTF) + " - " + other.getEndTime().format(DTF) + ").");
            }
        }

        if (isFinal) {
            boolean hasFinal = existing.stream().anyMatch(r -> Boolean.TRUE.equals(r.getIsFinal()));
            if (hasFinal) {
                throw new BadRequestException("An event can only have one final round. A final round already exists in this event.");
            }
        }

        LocalDateTime deadline = request.getSubmissionDeadline() != null
                ? request.getSubmissionDeadline()
                : request.getEndTime();

        // Temporary negative order number to avoid collision before re-sequencing
        int tempOrder = -(existing.size() + 100);
        Round round = Round.builder()
                .event(event)
                .name(request.getName().trim())
                .orderNumber(tempOrder)
                .startTime(request.getStartTime())
                .endTime(request.getEndTime())
                .submissionDeadline(deadline)
                .topNAdvance(request.getTopNAdvance())
                .isFinal(isFinal)
                .status("PENDING")
                .build();

        round = roundRepository.saveAndFlush(round);
        resequenceRounds(eventId);

        round = roundRepository.findById(round.getRoundId()).orElse(round);
        return mapToResponse(round);
    }

    @Transactional
    public RoundResponse updateRound(Integer eventId, Integer roundId, UpdateRoundRequest request) {
        Round round = roundRepository.findByIdAndEventId(roundId, eventId)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "Round ID " + roundId + " not found in Event ID " + eventId));

        LocalDateTime effectiveStart = request.getStartTime() != null ? request.getStartTime() : round.getStartTime();
        LocalDateTime effectiveEnd = request.getEndTime() != null ? request.getEndTime() : round.getEndTime();

        // 1. Check Start < End
        if (!effectiveStart.isBefore(effectiveEnd)) {
            throw new BadRequestException("Round start time must be strictly before end time.");
        }

        // 2. Check within event dates
        HackathonEvent event = round.getEvent();
        if (event.getStartDate() != null && effectiveStart.isBefore(event.getStartDate())) {
            throw new BadRequestException("Round start time (" + effectiveStart.format(DTF)
                    + ") cannot be earlier than event start date (" + event.getStartDate().format(DTF) + ").");
        }
        if (event.getEndDate() != null && effectiveEnd.isAfter(event.getEndDate())) {
            throw new BadRequestException("Round end time (" + effectiveEnd.format(DTF)
                    + ") cannot be later than event end date (" + event.getEndDate().format(DTF) + ").");
        }

        // 3. Check conflict/overlap with other rounds (excluding self)
        List<Round> existing = roundRepository.findAllByEvent_EventIdOrderByOrderNumber(eventId);
        for (Round other : existing) {
            if (other.getRoundId().equals(roundId)) continue;
            if (effectiveStart.isBefore(other.getEndTime()) && other.getStartTime().isBefore(effectiveEnd)) {
                throw new BadRequestException("Round time conflicts with round \"" + other.getName() + "\" ("
                        + other.getStartTime().format(DTF) + " - " + other.getEndTime().format(DTF) + ").");
            }
        }

        if (request.getName() != null && !request.getName().isBlank()) {
            round.setName(request.getName().trim());
        }
        if (request.getStartTime() != null) {
            round.setStartTime(request.getStartTime());
        }
        if (request.getEndTime() != null) {
            round.setEndTime(request.getEndTime());
            if (request.getSubmissionDeadline() == null) {
                round.setSubmissionDeadline(request.getEndTime());
            }
        }
        if (request.getSubmissionDeadline() != null) {
            round.setSubmissionDeadline(request.getSubmissionDeadline());
        }
        if (Boolean.TRUE.equals(request.getClearTopNAdvance())) {
            round.setTopNAdvance(null); // remove the cut-off entirely (no elimination)
        } else if (request.getTopNAdvance() != null) {
            round.setTopNAdvance(request.getTopNAdvance());
        }
        boolean finalChanged = false;
        if (request.getIsFinal() != null && !request.getIsFinal().equals(round.getIsFinal())) {
            if (Boolean.TRUE.equals(request.getIsFinal())) {
                boolean otherFinalExists = roundRepository.findAllByEvent_EventIdOrderByOrderNumber(eventId).stream()
                        .anyMatch(r -> !r.getRoundId().equals(roundId) && Boolean.TRUE.equals(r.getIsFinal()));
                if (otherFinalExists) {
                    throw new BadRequestException("An event can only have one final round. Another final round already exists in this event.");
                }
            }
            round.setIsFinal(request.getIsFinal());
            finalChanged = true;
        }

        if (request.getStatus() != null && !request.getStatus().isBlank()) {
            round.setStatus(request.getStatus().toUpperCase());
        }

        round = roundRepository.saveAndFlush(round);
        if (finalChanged) {
            resequenceRounds(eventId);
            round = roundRepository.findById(round.getRoundId()).orElse(round);
        }

        return mapToResponse(round);
    }

    @Transactional
    public void deleteRound(Integer eventId, Integer roundId) {
        Round round = roundRepository.findByIdAndEventId(roundId, eventId)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "Round ID " + roundId + " not found in Event ID " + eventId));

        if ("FINALIZED".equalsIgnoreCase(round.getStatus())) {
            throw new BadRequestException(
                    "Cannot delete a finalized round — its results are already locked.");
        }
        if (!submissionRepository.findAllByRound_RoundId(roundId).isEmpty()) {
            throw new BadRequestException(
                    "Cannot delete this round — teams have already submitted to it.");
        }

        // Safe to remove: no submissions and not finalized. Clear dependent criteria
        // (and any stray results) first so we don't trip a foreign-key constraint.
        var results = resultRepository.findAllByRound_RoundIdOrderByRankPosition(roundId);
        if (!results.isEmpty()) {
            resultRepository.deleteAll(results);
        }
        var criteria = criteriaRepository.findAllByRound_RoundIdOrderByOrderNumber(roundId);
        if (!criteria.isEmpty()) {
            criteriaRepository.deleteAll(criteria);
        }

        roundRepository.delete(round);
        roundRepository.flush();
        resequenceRounds(eventId);
    }

    private RoundResponse mapToResponse(Round round) {
        return RoundResponse.builder()
                .roundId(round.getRoundId())
                .eventId(round.getEvent().getEventId())
                .eventName(round.getEvent().getName())
                .name(round.getName())
                .orderNumber(round.getOrderNumber())
                .startTime(round.getStartTime())
                .endTime(round.getEndTime())
                .submissionDeadline(round.getSubmissionDeadline())
                .topNAdvance(round.getTopNAdvance())
                .isFinal(round.getIsFinal())
                .status(round.getStatus())
                .build();
    }

    private RoundDetailResponse mapToDetailResponse(Round round) {
        return RoundDetailResponse.builder()
                .roundId(round.getRoundId())
                .eventName(round.getEvent().getName())
                .roundName(round.getName())
                .orderNumber(round.getOrderNumber())
                .startTime(round.getStartTime())
                .endTime(round.getEndTime())
                .submissionDeadline(round.getSubmissionDeadline())
                .topNAdvance(round.getTopNAdvance())
                .isFinal(round.getIsFinal())
                .status(round.getStatus())
                .build();
    }
}
