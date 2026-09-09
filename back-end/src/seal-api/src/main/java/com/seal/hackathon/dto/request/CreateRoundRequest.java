package com.seal.hackathon.dto.request;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

import java.time.LocalDateTime;

@Data
public class CreateRoundRequest {
    @NotBlank(message = "Round name is required")
    private String name;

    private Integer orderNumber;

    @NotNull(message = "Start time is required")
    private LocalDateTime startTime;

    @NotNull(message = "End time is required")
    private LocalDateTime endTime;

    private LocalDateTime submissionDeadline;

    @Min(value = 1, message = "Top N advance must be at least 1")
    private Integer topNAdvance;

    // TRUE = final round (judges score all teams, no per-track split)
    private Boolean isFinal = false;
}
