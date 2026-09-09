package com.seal.hackathon.entity;

import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDateTime;

@Entity
@Table(name = "HackathonEvent")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class HackathonEvent {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "event_id")
    private Integer eventId;

    @Column(name = "name", nullable = false, length = 255)
    private String name;

    @Column(name = "season", nullable = false, length = 20)
    private String season;

    @Column(name = "`year`", nullable = false)
    private Integer year;

    @Column(name = "description", columnDefinition = "TEXT")
    private String description;

    // The overall competition theme for this hackathon (e.g. "AI-Driven Smart
    // Operations: Turning Real-Time IoT Data into Intelligent Actions") — distinct
    // from a track's own category, this applies to the whole event.
    @Column(name = "topic", length = 500)
    private String topic;

    @Column(name = "registration_start")
    private LocalDateTime registrationStart;

    @Column(name = "registration_end")
    private LocalDateTime registrationEnd;

    @Column(name = "start_date", nullable = false)
    private LocalDateTime startDate;

    @Column(name = "end_date", nullable = false)
    private LocalDateTime endDate;

    @Column(name = "status", nullable = false, length = 20)
    @Builder.Default
    private String status = "DRAFT";

    // How teams get a track: SELF_SELECT (leaders pick during SETUP, capped per
    // track) or RANDOM (coordinator draws during SETUP). Configured per event.
    @Column(name = "track_selection_mode", nullable = false, length = 20)
    @Builder.Default
    private String trackSelectionMode = "SELF_SELECT";

    // created_by removed from schema — who created the event is traceable via
    // AuditLog (action = CREATE_EVENT) if needed.

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @PrePersist
    protected void onCreate() {
        if (createdAt == null) {
            createdAt = LocalDateTime.now();
        }
    }
}
