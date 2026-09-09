package com.seal.hackathon.entity;

import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDateTime;

@Entity
@Table(name = "Round", uniqueConstraints = {
    @UniqueConstraint(name = "uq_round_event_order", columnNames = {"event_id", "order_number"})
})
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Round {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "round_id")
    private Integer roundId;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "event_id", nullable = false)
    private HackathonEvent event;

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "order_number", nullable = false)
    private Integer orderNumber;

    @Column(name = "start_time", nullable = false)
    private LocalDateTime startTime;

    @Column(name = "end_time", nullable = false)
    private LocalDateTime endTime;

    @Column(name = "submission_deadline")
    private LocalDateTime submissionDeadline;

    @Column(name = "top_n_advance")
    private Integer topNAdvance;

    // TRUE = final round (judges score all teams, no per-track split)
    @Column(name = "is_final", nullable = false)
    @Builder.Default
    private Boolean isFinal = false;

    @Column(name = "status", nullable = false, length = 20)
    @Builder.Default
    private String status = "PENDING";
}
