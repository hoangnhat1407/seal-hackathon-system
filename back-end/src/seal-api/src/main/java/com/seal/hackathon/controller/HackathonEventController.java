package com.seal.hackathon.controller;

import com.seal.hackathon.dto.request.CreateEventRequest;
import com.seal.hackathon.dto.request.UpdateEventRequest;
import com.seal.hackathon.dto.response.ApiResponse;
import com.seal.hackathon.dto.response.HackathonEventResponse;
import com.seal.hackathon.security.UserPrincipal;
import com.seal.hackathon.service.HackathonEventService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/events")
@RequiredArgsConstructor
public class HackathonEventController {

    private final HackathonEventService hackathonEventService;

    @GetMapping
    public ResponseEntity<ApiResponse<List<HackathonEventResponse>>> getAllEvents() {
        return ResponseEntity.ok(ApiResponse.success("Events retrieved successfully.",
                hackathonEventService.getAllHackathonEvents()));
    }

    @GetMapping("/{eventId}")
    public ResponseEntity<ApiResponse<HackathonEventResponse>> getEventById(@PathVariable Integer eventId) {
        return ResponseEntity.ok(ApiResponse.success("Event retrieved successfully.",
                hackathonEventService.getEventById(eventId)));
    }

    // Creating an event can only be done by Coordinator.
    @PostMapping
    @PreAuthorize("hasRole('EVENT_COORDINATOR')")
    public ResponseEntity<ApiResponse<HackathonEventResponse>> createEvent(
            @Valid @RequestBody CreateEventRequest request,
            Authentication authentication) {
        UserPrincipal principal = (UserPrincipal) authentication.getPrincipal();
        return ResponseEntity.ok(ApiResponse.success("Event created successfully.",
                hackathonEventService.createEvent(request, principal.getUserId())));
    }

    // Generic update (status transitions, dates, mode, name) — both the owning
    // Coordinator and the System Admin may patch. NOTE: reopening a COMPLETED
    // event is NOT possible here (the service's transition map blocks
    // COMPLETED -> *); use the dedicated /reopen endpoint below.
    @PutMapping("/{eventId}")
    @PreAuthorize("hasAnyRole('EVENT_COORDINATOR','SYSTEM_ADMIN')")
    public ResponseEntity<ApiResponse<HackathonEventResponse>> updateEvent(
            @PathVariable Integer eventId,
            @Valid @RequestBody UpdateEventRequest request) {
        return ResponseEntity.ok(ApiResponse.success("Event updated successfully.",
                hackathonEventService.updateEvent(eventId, request)));
    }

    // Complete a running event (IN_PROGRESS -> COMPLETED) — Coordinator only.
    @PostMapping("/{eventId}/complete")
    @PreAuthorize("hasRole('EVENT_COORDINATOR')")
    public ResponseEntity<ApiResponse<HackathonEventResponse>> completeEvent(
            @PathVariable Integer eventId) {
        return ResponseEntity.ok(ApiResponse.success("Event completed successfully.",
                hackathonEventService.completeEvent(eventId)));
    }

    // Reopen a COMPLETED event (COMPLETED -> IN_PROGRESS) — Coordinator only.
    @PostMapping("/{eventId}/reopen")
    @PreAuthorize("hasRole('EVENT_COORDINATOR')")
    public ResponseEntity<ApiResponse<HackathonEventResponse>> reopenEvent(
            @PathVariable Integer eventId) {
        return ResponseEntity.ok(ApiResponse.success("Event reopened successfully.",
                hackathonEventService.reopenEvent(eventId)));
    }
}

